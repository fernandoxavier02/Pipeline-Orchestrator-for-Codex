/**
 * Spec: pipeline-trust-restoration / R13 — Exec Window Resists Symlink Attack
 * Covers: R13 AC 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const OPEN_CJS = join(ROOT, "scripts", "exec-window", "open.cjs");

function encodeSessionId(sessionId: string): string {
  return `session-${Buffer.from(sessionId, "utf8").toString("base64url")}`;
}

function runOpen(cwd: string, payload: Record<string, unknown>) {
  return spawnSync(process.execPath, [OPEN_CJS], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

describe("R13: exec-window resists symlink attack", () => {
  it("R13 AC 13.5: pre-existing symlink at target → abort with SymlinkRefusedError", () => {
    if (platform() === "win32") {
      // Creating symlinks on Windows requires admin or developer-mode. Skip
      // gracefully and rely on the unit-level lstat check coverage on POSIX.
      return;
    }
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-exec-window-symlink-"));
    const sessionId = "test-session";
    const targetDir = join(cwd, ".codex", "pipeline", "sessions");
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${encodeSessionId(sessionId)}.exec-window`);

    // Pre-create a symlink to an attacker-controlled file outside .codex/
    const attackTarget = join(cwd, "attack-target.txt");
    writeFileSync(attackTarget, "original-content", "utf8");
    symlinkSync(attackTarget, targetPath);

    const result = runOpen(cwd, {
      session_id: sessionId,
      purpose: "smoke",
      spawning_agent: "test",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink-refused|SymlinkRefusedError/);
    // R13 AC 13.2 — the symlink target was NOT modified.
    expect(readFileSync(attackTarget, "utf8")).toBe("original-content");
  });

  it("R13 AC 13.4: normal rename proceeds when no symlink is present", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-exec-window-normal-"));
    const sessionId = "test-session-2";
    const targetDir = join(cwd, ".codex", "pipeline", "sessions");
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${encodeSessionId(sessionId)}.exec-window`);

    const result = runOpen(cwd, {
      session_id: sessionId,
      purpose: "smoke",
      spawning_agent: "test",
    });

    expect(result.status).toBe(0);
    expect(existsSync(targetPath)).toBe(true);
    const window = JSON.parse(readFileSync(targetPath, "utf8"));
    expect(window.session_id).toBe(sessionId);
  });
});
