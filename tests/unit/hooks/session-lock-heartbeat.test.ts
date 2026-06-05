import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "session-lock-hook.cjs");

function runHook(cwd: string, input: Record<string, unknown>) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

function writeLock(cwd: string, lock: Record<string, unknown>) {
  const dir = join(cwd, ".codex", "pipeline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session-lock.json"), JSON.stringify(lock), "utf8");
}

function readLock(cwd: string) {
  const p = join(cwd, ".codex", "pipeline", "session-lock.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("session-lock-hook heartbeat", () => {
  it("updates last_seen_at on UserPromptSubmit with active lock", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const now = Math.floor(Date.now() / 1000);
      writeLock(cwd, {
        session_id: "S1",
        created_at: now - 60,
        expires_at: now + 3600,
        status: "active",
        last_seen_at: now - 30,
      });

      const result = runHook(cwd, { event: "UserPromptSubmit", session_id: "S1" });

      expect(result.status).toBe(0);
      const updated = readLock(cwd);
      expect(updated).not.toBeNull();
      expect(updated.last_seen_at).toBeGreaterThanOrEqual(now);
      expect(updated.last_seen_at).toBeLessThanOrEqual(now + 5);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("removes expired lock on UserPromptSubmit", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const now = Math.floor(Date.now() / 1000);
      writeLock(cwd, {
        session_id: "S2",
        created_at: now - 7200,
        expires_at: now - 1,
        status: "active",
      });

      const result = runHook(cwd, { event: "UserPromptSubmit", session_id: "S2" });

      expect(result.status).toBe(0);
      expect(readLock(cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("no-ops when no lock exists on UserPromptSubmit", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const result = runHook(cwd, { event: "UserPromptSubmit", session_id: "S3" });

      expect(result.status).toBe(0);
      expect(readLock(cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not acquire a lock on normal Codex SessionStart", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const result = runHook(cwd, { source: "startup", session_id: "S4" });

      expect(result.status).toBe(0);
      expect(readLock(cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still supports explicit SessionStart lock enforcement", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const result = runHook(cwd, {
        source: "startup",
        session_id: "S4",
        enforce_session_lock: true,
      });

      expect(result.status).toBe(0);
      const lock = readLock(cwd);
      expect(lock).not.toBeNull();
      expect(lock.session_id).toBe("S4");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("records observable hook events as JSONL on heartbeat", () => {
    const cwd = mkdtempSync(join(tmpdir(), "session-lock-hb-"));
    try {
      const now = Math.floor(Date.now() / 1000);
      writeLock(cwd, {
        session_id: "S5",
        created_at: now - 60,
        expires_at: now + 3600,
        status: "active",
      });

      runHook(cwd, { event: "UserPromptSubmit", session_id: "S5" });

      const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
      expect(existsSync(eventsPath)).toBe(true);
      const lines = readFileSync(eventsPath, "utf8").trim().split("\n");
      const lastEvent = JSON.parse(lines[lines.length - 1]);
      expect(lastEvent).toMatchObject({
        hook: "session-lock",
        event: "UserPromptSubmit",
        decision: "heartbeat-updated",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
