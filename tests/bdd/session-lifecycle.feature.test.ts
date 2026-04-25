/**
 * Feature: Session lifecycle (B1 — session-lock)
 *
 * In order to prevent concurrent pipeline runs in the same workspace,
 * As the pipeline orchestrator,
 * The hooks/session-lock-hook.cjs SessionStart guard must:
 *   - block startup when an active lock exists,
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
    systemMessage?: string;
  };
}

function lockPath(root: string) {
  return join(root, ".codex", "pipeline", "session-lock.json");
}

describe("Feature: session-lock guards SessionStart", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "session-lock-bdd-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("Scenario: startup with no prior lock acquires the lock", () => {
    const out = runHook(workspace, { source: "startup", session_id: "A" });
    expect(out.decision).not.toBe("block");
    expect(existsSync(lockPath(workspace))).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("A");
    expect(lock.status).toBe("active");
  });

  it("Scenario: a second startup while the lock is active is blocked", () => {
    runHook(workspace, { source: "startup", session_id: "A" });
    const out = runHook(workspace, { source: "startup", session_id: "B" });
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("session_id=A");
  });

  it("Scenario: resume with an active lock is permitted without overwriting it", () => {
    runHook(workspace, { source: "startup", session_id: "A" });
    const before = readFileSync(lockPath(workspace), "utf8");
    const out = runHook(workspace, { source: "resume", session_id: "A" });
    expect(out.decision).not.toBe("block");
    const after = readFileSync(lockPath(workspace), "utf8");
    expect(after).toBe(before);
  });

  it("Scenario: source=clear releases the lock", () => {
    runHook(workspace, { source: "startup", session_id: "A" });
    const out = runHook(workspace, { source: "clear" });
    expect(out.decision).not.toBe("block");
    expect(existsSync(lockPath(workspace))).toBe(false);
  });

  it("Scenario: an expired lock allows a fresh startup", () => {
    const dir = join(workspace, ".codex", "pipeline");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const expired = {
      session_id: "OLD",
      created_at: 0,
      expires_at: 1, // long in the past
      status: "active",
    };
    writeFileSync(join(dir, "session-lock.json"), JSON.stringify(expired), "utf8");
    const out = runHook(workspace, { source: "startup", session_id: "NEW" });
    expect(out.decision).not.toBe("block");
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("NEW");
  });

  it("Scenario: resume with an expired lock refreshes it under the original session_id", () => {
    const dir = join(workspace, ".codex", "pipeline");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const expired = {
      session_id: "OLD",
      created_at: 0,
      expires_at: 1,
      status: "active",
    };
    writeFileSync(join(dir, "session-lock.json"), JSON.stringify(expired), "utf8");
    const out = runHook(workspace, { source: "resume", session_id: "ignored" });
    expect(out.decision).not.toBe("block");
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("OLD");
  });
});
