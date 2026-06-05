/**
 * Feature: Session lifecycle (B1 — session-lock)
 *
 * In order to prevent concurrent pipeline runs in the same workspace,
 * As the pipeline orchestrator,
 * The hooks/session-lock-hook.cjs SessionStart guard must:
 *   - avoid locking normal Codex startup/resume events,
 *   - block explicit pipeline startup when an active lock exists,
 *   - permit resume when the lock is still valid,
 *   - clear the lock when source=clear.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(process.cwd(), "hooks", "session-lock-hook.cjs");

function runHook(cwd: string, payload: Record<string, unknown>) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PIPELINE_SESSION_LOCK_TTL_SECONDS: "3600" },
  });
  if (result.status !== 0) {
    throw new Error(
      `session-lock-hook exited with ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim()) as {
    decision?: "block" | null;
    reason?: string;
    continue?: boolean;
    stopReason?: string;
    systemMessage?: string;
  };
}

function lockPath(root: string) {
  return join(root, ".codex", "pipeline", "session-lock.json");
}

describe("Feature: session-lock guards explicit pipeline SessionStart", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "session-lock-bdd-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("Scenario: normal Codex startup with no prior lock does not acquire the lock", () => {
    const out = runHook(workspace, { source: "startup", session_id: "A" });
    expect(out.decision).not.toBe("block");
    expect(out.continue).toBe(true);
    expect(existsSync(lockPath(workspace))).toBe(false);
  });

  it("Scenario: explicit pipeline startup with no prior lock acquires the lock", () => {
    const out = runHook(workspace, {
      source: "startup",
      session_id: "A",
      enforce_session_lock: true,
    });
    expect(out.decision).not.toBe("block");
    expect(existsSync(lockPath(workspace))).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("A");
    expect(lock.status).toBe("active");
  });

  it("Scenario: normal Codex startup while an explicit pipeline lock is active is permitted", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const out = runHook(workspace, { source: "startup", session_id: "B" });
    expect(out.continue).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("A");
  });

  it("Scenario: a second explicit pipeline startup while the lock is active is blocked", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const out = runHook(workspace, {
      source: "startup",
      session_id: "B",
      enforce_session_lock: true,
    });
    expect(out.continue).toBe(false);
    expect(out.stopReason).toContain("session_id=A");
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
  });

  it("Scenario: repeated explicit startup for the same active session is permitted", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const before = readFileSync(lockPath(workspace), "utf8");
    const out = runHook(workspace, {
      source: "startup",
      session_id: "A",
      enforce_session_lock: true,
    });
    expect(out.continue).toBe(true);
    const after = readFileSync(lockPath(workspace), "utf8");
    expect(after).toBe(before);
  });

  it("Scenario: explicit resume with an active lock is permitted without overwriting it", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const before = readFileSync(lockPath(workspace), "utf8");
    const out = runHook(workspace, { source: "resume", session_id: "A", enforce_session_lock: true });
    expect(out.decision).not.toBe("block");
    const after = readFileSync(lockPath(workspace), "utf8");
    expect(after).toBe(before);
  });

  it("Scenario: source=clear releases the lock", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const out = runHook(workspace, { source: "clear", session_id: "A" });
    expect(out.decision).not.toBe("block");
    expect(existsSync(lockPath(workspace))).toBe(false);
  });

  it("Scenario: source=clear with another session is blocked with the Codex SessionStart contract", () => {
    runHook(workspace, { source: "startup", session_id: "A", enforce_session_lock: true });
    const out = runHook(workspace, { source: "clear", session_id: "B" });
    expect(out.continue).toBe(false);
    expect(out.stopReason).toContain("provided session_id does not match active lock");
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(existsSync(lockPath(workspace))).toBe(true);
  });

  it("Scenario: an expired lock allows a fresh explicit pipeline startup", () => {
    const dir = join(workspace, ".codex", "pipeline");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const expired = {
      session_id: "OLD",
      created_at: 0,
      expires_at: 1, // long in the past
      status: "active",
    };
    writeFileSync(join(dir, "session-lock.json"), JSON.stringify(expired), "utf8");
    const out = runHook(workspace, {
      source: "startup",
      session_id: "NEW",
      enforce_session_lock: true,
    });
    expect(out.decision).not.toBe("block");
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("NEW");
  });

  it("Scenario: explicit resume with an expired lock refreshes it under the original session_id", () => {
    const dir = join(workspace, ".codex", "pipeline");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const expired = {
      session_id: "OLD",
      created_at: 0,
      expires_at: 1,
      status: "active",
    };
    writeFileSync(join(dir, "session-lock.json"), JSON.stringify(expired), "utf8");
    const out = runHook(workspace, {
      source: "resume",
      session_id: "ignored",
      enforce_session_lock: true,
    });
    expect(out.decision).not.toBe("block");
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("OLD");
  });
});
