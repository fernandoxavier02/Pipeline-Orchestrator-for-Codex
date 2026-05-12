import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptsDir = ".kimi/skills/pipeline/scripts";
const sessionsDir = ".pipeline/sessions";

function runScript(name: string, args: string): { stdout: string; stderr: string; exitCode: number } {
  const scriptPath = resolve(scriptsDir, name);
  try {
    const stdout = execSync(`node "${scriptPath}" ${args}`, {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status || 1,
    };
  }
}

function parseJson(str: string) {
  const lines = str.trim().split("\n");
  // Script may output warnings or extra lines; find the JSON line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed);
    }
  }
  throw new Error(`No JSON found in output: ${str}`);
}

describe("Exec-window scripts — runtime contract", () => {
  const sessionId = `test-session-${Date.now()}`;

  beforeAll(() => {
    // Clean up any stale test sessions
    if (existsSync(sessionsDir)) {
      const files = execSync(`ls ${sessionsDir}/*.exec-window 2>/dev/null || true`, { encoding: "utf8" });
      for (const file of files.trim().split("\n").filter(Boolean)) {
        if (file.includes("test-session-")) {
          rmSync(file.trim());
        }
      }
    }
  });

  afterAll(() => {
    // Clean up test session
    const sessionFile = resolve(sessionsDir, `${sessionId}.exec-window`);
    if (existsSync(sessionFile)) {
      rmSync(sessionFile);
    }
  });

  describe("open-exec-window.cjs", () => {
    it("must create a valid exec-window with default TTL", () => {
      const result = runScript("open-exec-window.cjs", `--session-id=${sessionId} --purpose="test batch execution"`);
      expect(result.exitCode).toBe(0);

      const payload = parseJson(result.stdout);
      expect(payload.status).toBe("success");
      expect(payload.session_id).toBe(sessionId);
      expect(payload.expires_at).toBeTypeOf("number");

      const now = Date.now();
      const fiveMinutesMs = 5 * 60 * 1000;
      expect(payload.expires_at).toBeGreaterThan(now);
      expect(payload.expires_at).toBeLessThanOrEqual(now + fiveMinutesMs + 2000); // +2s tolerance
    });

    it("must reject missing session_id", () => {
      const result = runScript("open-exec-window.cjs", `--purpose="test"`);
      expect(result.exitCode).toBe(1);
      const payload = parseJson(result.stderr);
      expect(payload.status).toBe("error");
    });

    it("must reject missing purpose", () => {
      const result = runScript("open-exec-window.cjs", `--session-id=${sessionId}-no-purpose`);
      expect(result.exitCode).toBe(1);
      const payload = parseJson(result.stderr);
      expect(payload.status).toBe("error");
    });

    it("must reject TTL > 60 minutes", () => {
      const result = runScript("open-exec-window.cjs", `--session-id=${sessionId}-bad-ttl --purpose="test" --ttl-minutes=120`);
      expect(result.exitCode).toBe(1);
      const payload = parseJson(result.stderr);
      expect(payload.status).toBe("error");
    });

    it("must enforce mutual exclusion (no duplicate active session)", () => {
      // sessionId was already opened in the first test
      const result = runScript("open-exec-window.cjs", `--session-id=${sessionId} --purpose="duplicate"`);
      expect(result.exitCode).toBe(1);
      const payload = parseJson(result.stderr);
      expect(payload.status).toBe("error");
      expect(payload.reason).toMatch(/already has an active exec-window/i);
    });

    it("must write valid JSON to .pipeline/sessions/<id>.exec-window", () => {
      const sessionFile = resolve(sessionsDir, `${sessionId}.exec-window`);
      expect(existsSync(sessionFile), "exec-window file should exist").toBe(true);

      const content = readFileSync(sessionFile, "utf8");
      const payload = JSON.parse(content);
      expect(payload.session_id).toBe(sessionId);
      expect(payload.purpose).toBe("test batch execution");
      expect(payload.ttl_minutes).toBe(5);
      expect(payload.opened_at).toBeTypeOf("number");
      expect(payload.expires_at).toBeTypeOf("number");
      expect(payload.spawning_agent).toBe("pipeline-controller");
    });

    it("must append an audit line to audit.log", () => {
      const auditLog = resolve(sessionsDir, "audit.log");
      expect(existsSync(auditLog), "audit.log should exist").toBe(true);

      const lines = readFileSync(auditLog, "utf8").trim().split("\n").filter(Boolean);
      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine.event).toBe("exec-window-opened");
      expect(lastLine.session_id).toBe(sessionId);
      expect(lastLine.purpose).toBe("test batch execution");
      expect(lastLine.timestamp).toBeTypeOf("number");
    });
  });

  describe("validate-exec-window.cjs", () => {
    it("must return valid for an active exec-window", () => {
      const result = runScript("validate-exec-window.cjs", `--session-id=${sessionId}`);
      expect(result.exitCode).toBe(0);

      const payload = parseJson(result.stdout);
      expect(payload.status).toBe("valid");
      expect(payload.session_id).toBe(sessionId);
      expect(payload.remaining_seconds).toBeTypeOf("number");
      expect(payload.remaining_seconds).toBeGreaterThan(0);
    });

    it("must return invalid for a non-existent session", () => {
      const result = runScript("validate-exec-window.cjs", `--session-id=${sessionId}-never-existed`);
      expect(result.exitCode).toBe(0);

      const payload = parseJson(result.stdout);
      expect(payload.status).toBe("invalid");
    });

    it("must reject missing session_id", () => {
      const result = runScript("validate-exec-window.cjs", "");
      expect(result.exitCode).toBe(1);
      const payload = parseJson(result.stderr);
      expect(payload.status).toBe("error");
    });
  });

  describe("close-exec-window.cjs", () => {
    it("must close an active exec-window and remove the file", () => {
      const result = runScript("close-exec-window.cjs", `--session-id=${sessionId}`);
      expect(result.exitCode).toBe(0);

      const payload = parseJson(result.stdout);
      expect(payload.status).toBe("success");
      expect(payload.session_id).toBe(sessionId);

      const sessionFile = resolve(sessionsDir, `${sessionId}.exec-window`);
      expect(existsSync(sessionFile), "exec-window file should be removed").toBe(false);
    });

    it("must be idempotent (closing non-existent session succeeds)", () => {
      const result = runScript("close-exec-window.cjs", `--session-id=${sessionId}-never-existed`);
      expect(result.exitCode).toBe(0);

      const payload = parseJson(result.stdout);
      expect(payload.status).toBe("success");
    });

    it("must append a close audit line", () => {
      const auditLog = resolve(sessionsDir, "audit.log");
      const lines = readFileSync(auditLog, "utf8").trim().split("\n").filter(Boolean);
      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine.event).toBe("exec-window-closed");
      expect(lastLine.session_id).toBe(sessionId);
      expect(lastLine.timestamp).toBeTypeOf("number");
    });
  });
});
