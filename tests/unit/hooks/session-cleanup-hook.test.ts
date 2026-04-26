import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(process.cwd(), "hooks", "session-cleanup-hook.cjs");

function runHook(cwd: string) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({}),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `session-cleanup-hook exited with ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim() || "{}") as { continue?: boolean };
}

function lockPath(root: string) {
  return join(root, ".codex", "pipeline", "session-lock.json");
}

function execWindowPath(root: string, sessionId: string) {
  return join(root, ".codex", "pipeline", "sessions", `${sessionId}.exec-window`);
}

describe("session-cleanup-hook (B10)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "session-cleanup-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("never blocks (always emits continue=true)", () => {
    const out = runHook(workspace);
    expect(out.continue).toBe(true);
  });

  it("removes an expired session-lock", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    writeFileSync(
      lockPath(workspace),
      JSON.stringify({
        session_id: "S1",
        created_at: 0,
        expires_at: 1,
        status: "active",
      }),
      "utf8",
    );
    runHook(workspace);
    expect(existsSync(lockPath(workspace))).toBe(false);
  });

  it("preserves an active session-lock", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    const future = Math.floor(Date.now() / 1000) + 3600;
    writeFileSync(
      lockPath(workspace),
      JSON.stringify({
        session_id: "S1",
        created_at: 0,
        expires_at: future,
        status: "active",
      }),
      "utf8",
    );
    runHook(workspace);
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("S1");
  });

  it("sweeps expired exec-windows but keeps OPEN ones", () => {
    mkdirSync(join(workspace, ".codex", "pipeline", "sessions"), { recursive: true });
    const future = Math.floor(Date.now() / 1000) + 600;
    writeFileSync(
      execWindowPath(workspace, "OPEN"),
      JSON.stringify({
        session_id: "OPEN",
        opened_at: 0,
        expires_at: future,
        purpose: "p",
        spawning_agent: "pipeline-controller",
      }),
      "utf8",
    );
    writeFileSync(
      execWindowPath(workspace, "EXPIRED"),
      JSON.stringify({
        session_id: "EXPIRED",
        opened_at: 0,
        expires_at: 1,
        purpose: "p",
        spawning_agent: "pipeline-controller",
      }),
      "utf8",
    );
    runHook(workspace);
    expect(existsSync(execWindowPath(workspace, "OPEN"))).toBe(true);
    expect(existsSync(execWindowPath(workspace, "EXPIRED"))).toBe(false);
  });

  it("is a no-op when no .codex/pipeline directory exists", () => {
    const out = runHook(workspace);
    expect(out.continue).toBe(true);
  });
});
