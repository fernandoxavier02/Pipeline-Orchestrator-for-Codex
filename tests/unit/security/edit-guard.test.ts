import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EditGuardBlockedError,
  WRITE_CAPABLE_ROLES,
  ensureWriteAuthorized,
  evaluateEditGuard,
  isWriteCapableRole,
} from "../../../src/security/edit-guard.js";
import { buildExecWindow } from "../../../src/security/exec-window.js";
import { createExecWindowStore } from "../../../src/security/exec-window-store.js";

describe("evaluateEditGuard", () => {
  it("allows non-write roles regardless of window state", () => {
    const v = evaluateEditGuard({
      role: "review-orchestrator",
      window: null,
      now: 0,
      sessionRootProvided: true,
    });
    expect(v.kind).toBe("allow");
    if (v.kind === "allow") expect(v.reason).toBe("non-write-role");
  });

  it("allows when guard is disabled (no sessionRoot)", () => {
    const v = evaluateEditGuard({
      role: "executor-implementer",
      window: null,
      now: 0,
      sessionRootProvided: false,
    });
    expect(v.kind).toBe("allow");
    if (v.kind === "allow") expect(v.reason).toBe("guard-disabled");
  });

  it("blocks write-capable role with no window (CLOSED)", () => {
    const v = evaluateEditGuard({
      role: "executor-implementer",
      window: null,
      now: 0,
      sessionRootProvided: true,
    });
    expect(v.kind).toBe("block");
    if (v.kind === "block") expect(v.windowState).toBe("CLOSED");
  });

  it("blocks write-capable role with EXPIRED window", () => {
    const w = buildExecWindow({
      session_id: "S1",
      now: 0,
      ttl_seconds: 10,
      purpose: "p",
      spawning_agent: "a",
    });
    const v = evaluateEditGuard({
      role: "executor-implementer",
      window: w,
      now: 100,
      sessionRootProvided: true,
    });
    expect(v.kind).toBe("block");
    if (v.kind === "block") expect(v.windowState).toBe("EXPIRED");
  });

  it("allows write-capable role with OPEN window", () => {
    const w = buildExecWindow({
      session_id: "S1",
      now: 0,
      ttl_seconds: 100,
      purpose: "p",
      spawning_agent: "a",
    });
    const v = evaluateEditGuard({
      role: "executor-implementer",
      window: w,
      now: 1,
      sessionId: "S1",
      sessionRootProvided: true,
    });
    expect(v.kind).toBe("allow");
    if (v.kind === "allow") expect(v.reason).toBe("open-window");
  });

  it("blocks when window session_id mismatches dispatch session_id", () => {
    const w = buildExecWindow({
      session_id: "S1",
      now: 0,
      ttl_seconds: 100,
      purpose: "p",
      spawning_agent: "a",
    });
    const v = evaluateEditGuard({
      role: "executor-implementer",
      window: w,
      now: 1,
      sessionId: "OTHER",
      sessionRootProvided: true,
    });
    expect(v.kind).toBe("block");
  });

  it("WRITE_CAPABLE_ROLES contains the canonical executor roles", () => {
    expect(isWriteCapableRole("executor-implementer")).toBe(true);
    expect(isWriteCapableRole("executor-fix")).toBe(true);
    expect(isWriteCapableRole("review-orchestrator")).toBe(false);
    expect(WRITE_CAPABLE_ROLES.size).toBeGreaterThanOrEqual(3);
  });
});

describe("ensureWriteAuthorized (with on-disk window)", () => {
  it("throws EditGuardBlockedError for write-capable role with no window", () => {
    const root = mkdtempSync(join(tmpdir(), "edit-guard-"));
    try {
      expect(() =>
        ensureWriteAuthorized({
          role: "executor-implementer",
          sessionRoot: root,
          sessionId: "S1",
          now: 0,
        }),
      ).toThrow(EditGuardBlockedError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not throw for write-capable role with OPEN window on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "edit-guard-"));
    try {
      const store = createExecWindowStore(root);
      store.write(
        "S1",
        buildExecWindow({
          session_id: "S1",
          now: 0,
          ttl_seconds: 600,
          purpose: "p",
          spawning_agent: "a",
        }),
      );
      expect(() =>
        ensureWriteAuthorized({
          role: "executor-implementer",
          sessionRoot: root,
          sessionId: "S1",
          now: 5,
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks with EXPIRED windowState after deleting the file (CLOSED) — reuse prevention", () => {
    const root = mkdtempSync(join(tmpdir(), "edit-guard-"));
    try {
      const store = createExecWindowStore(root);
      store.write(
        "S1",
        buildExecWindow({
          session_id: "S1",
          now: 0,
          ttl_seconds: 600,
          purpose: "p",
          spawning_agent: "a",
        }),
      );
      store.delete("S1");
      let caught: EditGuardBlockedError | undefined;
      try {
        ensureWriteAuthorized({
          role: "executor-implementer",
          sessionRoot: root,
          sessionId: "S1",
          now: 5,
        });
      } catch (err) {
        caught = err as EditGuardBlockedError;
      }
      expect(caught).toBeInstanceOf(EditGuardBlockedError);
      expect(caught?.windowState).toBe("CLOSED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
