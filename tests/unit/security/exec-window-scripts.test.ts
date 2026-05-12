import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const OPEN_SCRIPT = join(ROOT, "scripts", "exec-window", "open.cjs");
const CLOSE_SCRIPT = join(ROOT, "scripts", "exec-window", "close.cjs");

function runOpen(cwd: string, input: Record<string, unknown>) {
  return spawnSync(process.execPath, [OPEN_SCRIPT], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

function runClose(cwd: string, input: Record<string, unknown>) {
  return spawnSync(process.execPath, [CLOSE_SCRIPT], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}

describe("exec-window scripts", () => {
  it("open.cjs creates exec-window file with OPEN state and TTL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-open-"));
    try {
      const result = runOpen(cwd, {
        session_id: "S1",
        ttl_seconds: 300,
        purpose: "batch-0",
        spawning_agent: "executor-controller",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.status).toBe("OPEN");
      expect(output.session_id).toBe("S1");
      expect(typeof output.expires_at).toBe("number");
      expect(output.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const windowPath = join(cwd, ".codex", "pipeline", "sessions", `session-${Buffer.from("S1", "utf8").toString("base64url")}.exec-window`);
      expect(existsSync(windowPath)).toBe(true);
      const window = JSON.parse(readFileSync(windowPath, "utf8"));
      expect(window.session_id).toBe("S1");
      expect(window.purpose).toBe("batch-0");
      expect(window.spawning_agent).toBe("executor-controller");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("open.cjs defaults TTL to 300 seconds when omitted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-open-"));
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = runOpen(cwd, {
        session_id: "S2",
        purpose: "test",
        spawning_agent: "pipeline-controller",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.expires_at).toBeGreaterThanOrEqual(now + 300);
      expect(output.expires_at).toBeLessThanOrEqual(now + 306);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("open.cjs fails if window already OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-open-"));
    try {
      runOpen(cwd, { session_id: "S3", purpose: "first", spawning_agent: "a" });
      const result = runOpen(cwd, { session_id: "S3", purpose: "second", spawning_agent: "a" });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("already OPEN");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("open.cjs rejects invalid TTL (> 3600)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-open-"));
    try {
      const result = runOpen(cwd, {
        session_id: "S4",
        ttl_seconds: 4000,
        purpose: "test",
        spawning_agent: "a",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("MAX_TTL");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("close.cjs updates exec-window to CLOSED and appends audit log", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-close-"));
    try {
      runOpen(cwd, { session_id: "S5", purpose: "batch", spawning_agent: "a" });

      const result = runClose(cwd, { session_id: "S5" });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.status).toBe("CLOSED");

      const windowPath = join(cwd, ".codex", "pipeline", "sessions", `session-${Buffer.from("S5", "utf8").toString("base64url")}.exec-window`);
      expect(existsSync(windowPath)).toBe(false);

      const gateLogPath = join(cwd, ".codex", "pipeline", "gate-decisions.jsonl");
      expect(existsSync(gateLogPath)).toBe(true);
      const lines = readFileSync(gateLogPath, "utf8").trim().split("\n");
      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine.gate).toBe("EXEC_WINDOW_CLOSE");
      expect(lastLine.session_id).toBe("S5");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("close.cjs fails if window was never OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-close-"));
    try {
      const result = runClose(cwd, { session_id: "S-NOEXIST" });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("not OPEN");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("close.cjs fails if window is EXPIRED", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-close-"));
    try {
      // Create an expired window manually
      const windowPath = join(cwd, ".codex", "pipeline", "sessions", `session-${Buffer.from("S6", "utf8").toString("base64url")}.exec-window`);
      mkdirSync(join(cwd, ".codex", "pipeline", "sessions"), { recursive: true });
      writeFileSync(windowPath, JSON.stringify({
        session_id: "S6",
        opened_at: 0,
        expires_at: 1,
        purpose: "test",
        spawning_agent: "a",
      }), "utf8");

      const result = runClose(cwd, { session_id: "S6" });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EXPIRED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("open.cjs rejects symlinks at target path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-symlink-"));
    try {
      const sessionsDir = join(cwd, ".codex", "pipeline", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const windowPath = join(sessionsDir, `session-${Buffer.from("S7", "utf8").toString("base64url")}.exec-window`);
      // Create a symlink pointing to a sensitive file
      const baitFile = join(cwd, "bait-target.txt");
      writeFileSync(baitFile, "original", "utf8");

      // Skip on Windows if symlinks require elevation
      try {
        require("fs").symlinkSync(baitFile, windowPath);
      } catch {
        // Symlinks not supported or no privileges — skip this test
        return;
      }

      const result = runOpen(cwd, {
        session_id: "S7",
        purpose: "symlink-test",
        spawning_agent: "a",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("symbolic link");
      expect(readFileSync(baitFile, "utf8")).toBe("original");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("open.cjs defaults TTL for fractional input", () => {
    const cwd = mkdtempSync(join(tmpdir(), "exec-window-ttl-"));
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = runOpen(cwd, {
        session_id: "S8",
        ttl_seconds: 0.1,
        purpose: "test",
        spawning_agent: "a",
      });

      // Fractional TTL should be rejected and default to 300
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.expires_at).toBeGreaterThanOrEqual(now + 300);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
