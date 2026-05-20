import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_EXEC_WINDOW_TTL_SECONDS,
  MAX_EXEC_WINDOW_TTL_SECONDS,
  buildExecWindow,
  classifyExecWindow,
  isOpen,
  parseExecWindow,
} from "../../../src/security/exec-window.js";
import {
  createExecWindowStore,
  deleteExecWindow,
  execWindowDir,
  execWindowPath,
  readExecWindow,
  writeExecWindowAtomic,
} from "../../../src/security/exec-window-store.js";

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "exec-window-"));
}

describe("ExecWindow value object", () => {
  it("buildExecWindow defaults TTL to 5 minutes and freezes the result", () => {
    const w = buildExecWindow({
      session_id: "S1",
      now: 1000,
      purpose: "executor-implementer batch 1",
      spawning_agent: "pipeline-controller",
    });
    expect(w.expires_at - w.opened_at).toBe(DEFAULT_EXEC_WINDOW_TTL_SECONDS);
    expect(Object.isFrozen(w)).toBe(true);
  });

  it("buildExecWindow rejects ttl > MAX and ttl <= 0", () => {
    expect(() =>
      buildExecWindow({
        session_id: "S1",
        now: 1,
        ttl_seconds: MAX_EXEC_WINDOW_TTL_SECONDS + 1,
        purpose: "p",
        spawning_agent: "a",
      }),
    ).toThrow(/MAX_EXEC_WINDOW_TTL_SECONDS/);
    expect(() =>
      buildExecWindow({
        session_id: "S1",
        now: 1,
        ttl_seconds: 0,
        purpose: "p",
        spawning_agent: "a",
      }),
    ).toThrow();
  });

  it("classifyExecWindow returns OPEN/EXPIRED/CLOSED correctly", () => {
    const w = buildExecWindow({
      session_id: "S1",
      now: 0,
      ttl_seconds: 10,
      purpose: "p",
      spawning_agent: "a",
    });
    expect(classifyExecWindow(w, 5)).toBe("OPEN");
    expect(classifyExecWindow(w, 10)).toBe("EXPIRED"); // expires_at == now → not OPEN
    expect(classifyExecWindow(w, 11)).toBe("EXPIRED");
    expect(classifyExecWindow(null, 0)).toBe("CLOSED");
    expect(isOpen(w, 5)).toBe(true);
    expect(isOpen(w, 11)).toBe(false);
  });

  it("parseExecWindow rejects malformed payloads", () => {
    expect(() => parseExecWindow("{}")).toThrow();
    expect(() =>
      parseExecWindow(JSON.stringify({ session_id: "S", opened_at: 0, expires_at: 1, purpose: "p" })),
    ).toThrow();
  });
});

describe("exec-window-store", () => {
  it("execWindowPath rejects empty sessionIds", () => {
    const root = freshRoot();
    expect(() => execWindowPath(root, "")).toThrow(/required/);
    rmSync(root, { recursive: true, force: true });
  });

  it("execWindowPath rejects sessionIds beyond the length limit", () => {
    const root = freshRoot();
    expect(() => execWindowPath(root, "x".repeat(513))).toThrow(/exceeds/);
    rmSync(root, { recursive: true, force: true });
  });

  it("execWindowPath neutralizes path-traversal inputs via base64url encoding", () => {
    const root = freshRoot();
    // Raw input may contain "..", "/", "\\" — base64url encoding produces only
    // [A-Za-z0-9_-], so the resulting filename is safe regardless of input.
    const path = execWindowPath(root, "../../etc/passwd");
    expect(path).toContain("/sessions/");
    expect(path).not.toMatch(/\.\.\//);
    rmSync(root, { recursive: true, force: true });
  });

  it("execWindowPath maps distinct sessionIds to distinct files (injectivity)", () => {
    const root = freshRoot();
    const a = execWindowPath(root, "a/b");
    const b = execWindowPath(root, "a-b");
    expect(a).not.toBe(b);
    rmSync(root, { recursive: true, force: true });
  });

  it("execWindowPath supports command-style sessionIds with slashes", () => {
    const root = freshRoot();
    try {
      const store = createExecWindowStore(root);
      const sessionId = "full:/pipeline-orchestrator-for-codex:brainstorm explore ideas";
      const path = store.pathFor(sessionId);
      expect(path).toBeTruthy();
      const w = buildExecWindow({
        session_id: sessionId,
        now: 1,
        ttl_seconds: 30,
        purpose: "brainstorm",
        spawning_agent: "pipeline-controller",
      });
      store.write(sessionId, w);
      expect(store.read(sessionId)).toEqual(w);
      expect(store.delete(sessionId)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("execWindowPath supports command-style sessionIds that contain Windows-invalid filename characters", () => {
    const root = freshRoot();
    try {
      const store = createExecWindowStore(root);
      const sessionId = "--complexa:stabilize login flow";
      const path = store.pathFor(sessionId);
      expect(path).not.toContain(sessionId);
      const w = buildExecWindow({
        session_id: sessionId,
        now: 1,
        ttl_seconds: 30,
        purpose: "p",
        spawning_agent: "a",
      });
      store.write(sessionId, w);
      expect(store.read(sessionId)).toEqual(w);
      expect(store.delete(sessionId)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("write/read/delete round-trip + atomic overwrite", () => {
    const root = freshRoot();
    try {
      const path = execWindowPath(root, "S1");
      expect(existsSync(execWindowDir(root))).toBe(false);
      const w = buildExecWindow({
        session_id: "S1",
        now: 0,
        ttl_seconds: 10,
        purpose: "p",
        spawning_agent: "a",
      });
      writeExecWindowAtomic(path, w);
      expect(readExecWindow(path)).toEqual(w);

      const w2 = buildExecWindow({
        session_id: "S1",
        now: 5,
        ttl_seconds: 30,
        purpose: "p",
        spawning_agent: "a",
      });
      writeExecWindowAtomic(path, w2);
      expect(JSON.parse(readFileSync(path, "utf8")).expires_at).toBe(35);
      expect(existsSync(`${path}.tmp`)).toBe(false);

      expect(deleteExecWindow(path)).toBe(true);
      expect(existsSync(path)).toBe(false);
      expect(deleteExecWindow(path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("createExecWindowStore exposes pathFor/read/write/delete by sessionId", () => {
    const root = freshRoot();
    try {
      const store = createExecWindowStore(root);
      expect(store.read("S1")).toBeNull();
      const w = buildExecWindow({
        session_id: "S1",
        now: 1,
        ttl_seconds: 30,
        purpose: "p",
        spawning_agent: "a",
      });
      store.write("S1", w);
      expect(store.read("S1")).toEqual(w);
      expect(store.delete("S1")).toBe(true);
      expect(store.read("S1")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
