import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const scriptsDir = resolve("scripts/exec-window");

function runScript(name: string, input: Record<string, unknown>, cwd: string) {
  const scriptPath = resolve(scriptsDir, name);
  const stdout = execSync(`node "${scriptPath}"`, {
    input: JSON.stringify(input) + "\n",
    encoding: "utf8",
    cwd,
  });
  return { exitCode: 0, stdout: stdout.trim() };
}

function runScriptExpectError(name: string, input: Record<string, unknown>, cwd: string) {
  const scriptPath = resolve(scriptsDir, name);
  try {
    execSync(`node "${scriptPath}"`, {
      input: JSON.stringify(input) + "\n",
      encoding: "utf8",
      cwd,
    });
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout ?? "").toString().trim(),
      stderr: (err.stderr ?? "").toString().trim(),
    };
  }
}

describe("Codex exec-window scripts — runtime contract", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codex-exec-window-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("open.cjs", () => {
    it("must open an exec-window with default TTL", () => {
      const { stdout } = runScript("open.cjs", {
        session_id: "test-session",
        purpose: "testing",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("OPEN");
      expect(parsed.session_id).toBe("test-session");
      expect(typeof parsed.expires_at).toBe("number");
      expect(parsed.purpose).toBe("testing");
      expect(parsed.spawning_agent).toBe("pipeline-controller");

      const windowFile = join(tmpDir, ".codex", "pipeline", "sessions", "session-dGVzdC1zZXNzaW9u.exec-window");
      expect(existsSync(windowFile)).toBe(true);
    });

    it("must reject TTL > 3600 seconds", () => {
      const { exitCode, stderr } = runScriptExpectError("open.cjs", {
        session_id: "test-session",
        purpose: "testing",
        spawning_agent: "pipeline-controller",
        ttl_seconds: 7200,
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("MAX_TTL");
    });

    it("must reject missing session_id", () => {
      const { exitCode, stderr } = runScriptExpectError("open.cjs", {
        purpose: "testing",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("session_id");
    });

    it("must reject missing purpose", () => {
      const { exitCode, stderr } = runScriptExpectError("open.cjs", {
        session_id: "test-session",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("purpose");
    });

    it("must reject missing spawning_agent", () => {
      const { exitCode, stderr } = runScriptExpectError("open.cjs", {
        session_id: "test-session",
        purpose: "testing",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("spawning_agent");
    });

    it("must reject duplicate active session for same session_id", () => {
      runScript("open.cjs", {
        session_id: "dup-session",
        purpose: "first",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      const { exitCode, stderr } = runScriptExpectError("open.cjs", {
        session_id: "dup-session",
        purpose: "second",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("already OPEN");
    });

    it("must allow reopen after close", () => {
      runScript("open.cjs", {
        session_id: "reopen-session",
        purpose: "first",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      runScript("close.cjs", { session_id: "reopen-session" }, tmpDir);

      const { stdout } = runScript("open.cjs", {
        session_id: "reopen-session",
        purpose: "second",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("OPEN");
      expect(parsed.purpose).toBe("second");
    });
  });

  describe("close.cjs", () => {
    it("must close an active exec-window and append gate-decisions.jsonl", () => {
      runScript("open.cjs", {
        session_id: "close-test",
        purpose: "testing",
        spawning_agent: "pipeline-controller",
      }, tmpDir);

      const { stdout } = runScript("close.cjs", { session_id: "close-test" }, tmpDir);
      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("CLOSED");
      expect(parsed.session_id).toBe("close-test");
      expect(typeof parsed.closed_at).toBe("number");

      const windowFile = join(tmpDir, ".codex", "pipeline", "sessions", "session-Y2xvc2UtdGVzdA.exec-window");
      expect(existsSync(windowFile)).toBe(false);

      const gateLog = join(tmpDir, ".codex", "pipeline", "gate-decisions.jsonl");
      expect(existsSync(gateLog)).toBe(true);
      const lines = readFileSync(gateLog, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const last = JSON.parse(lines[lines.length - 1]);
      expect(last.gate).toBe("EXEC_WINDOW_CLOSE");
      expect(last.session_id).toBe("close-test");
    });

    it("must reject closing a non-existent exec-window", () => {
      const { exitCode, stderr } = runScriptExpectError("close.cjs", {
        session_id: "never-opened",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("not OPEN");
    });

    it("must reject closing an expired exec-window", () => {
      runScript("open.cjs", {
        session_id: "expired-session",
        purpose: "testing",
        spawning_agent: "pipeline-controller",
        ttl_seconds: 1,
      }, tmpDir);

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 1500) { /* spin */ }

      const { exitCode, stderr } = runScriptExpectError("close.cjs", {
        session_id: "expired-session",
      }, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("EXPIRED");
    });

    it("must reject missing session_id", () => {
      const { exitCode, stderr } = runScriptExpectError("close.cjs", {}, tmpDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("session_id");
    });
  });
});
