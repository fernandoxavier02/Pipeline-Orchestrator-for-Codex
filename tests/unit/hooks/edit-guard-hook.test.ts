import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "edit-guard-hook.cjs");

function encodeSessionId(sessionId: string) {
  return `session-${Buffer.from(sessionId, "utf8").toString("base64url")}`;
}

function runHook(cwd: string, toolName: string, filePath: string) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      tool_name: toolName,
      tool_input: { file_path: filePath },
    }),
    encoding: "utf8",
  });
}

function writeExecWindow(cwd: string, sessionId: string, expiresAt: number) {
  const dir = join(cwd, ".codex", "pipeline", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${encodeSessionId(sessionId)}.exec-window`), JSON.stringify({
    session_id: sessionId,
    opened_at: Math.floor(Date.now() / 1000) - 10,
    expires_at: expiresAt,
    purpose: "test",
    spawning_agent: "executor-controller",
  }), "utf8");
}

function writeSessionLock(cwd: string, sessionId: string, expiresAt: number) {
  const dir = join(cwd, ".codex", "pipeline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session-lock.json"), JSON.stringify({
    session_id: sessionId,
    created_at: Math.floor(Date.now() / 1000) - 60,
    expires_at: expiresAt,
    status: "active",
  }), "utf8");
}

function writeChangeContract(cwd: string, contract: Record<string, unknown>) {
  const dir = join(cwd, ".codex", "pipeline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "change-contract.json"), JSON.stringify({
    allowed_files: [],
    allowed_new_files: [],
    forbidden_files: [],
    ...contract,
  }), "utf8");
}

describe("edit-guard-hook", () => {
  it("denies Edit when no exec-window is open", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S1", Math.floor(Date.now() / 1000) + 3600);

      const result = runHook(cwd, "Edit", join(cwd, "src", "main.ts"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("CLOSED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies Write when exec-window is expired", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S2", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S2", Math.floor(Date.now() / 1000) - 1);

      const result = runHook(cwd, "Write", join(cwd, "src", "main.ts"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("EXPIRED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows Edit inside .codex/pipeline/ regardless of window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S3", Math.floor(Date.now() / 1000) + 3600);

      const result = runHook(cwd, "Edit", join(cwd, ".codex", "pipeline", "session.json"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows Edit inside pipeline-runs/ regardless of window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S4", Math.floor(Date.now() / 1000) + 3600);

      const result = runHook(cwd, "Edit", join(cwd, "pipeline-runs", "001-test", "manifest.yaml"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows Edit when exec-window is OPEN and valid", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S5", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S5", Math.floor(Date.now() / 1000) + 300);

      const result = runHook(cwd, "Edit", join(cwd, "src", "main.ts"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows NotebookEdit when exec-window is OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S6", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S6", Math.floor(Date.now() / 1000) + 300);

      const result = runHook(cwd, "NotebookEdit", join(cwd, "src", "notebook.ipynb"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows MultiEdit when exec-window is OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S7", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S7", Math.floor(Date.now() / 1000) + 300);

      const result = runHook(cwd, "MultiEdit", join(cwd, "src", "a.ts"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies Edit outside the active CHANGE_CONTRACT even when exec-window is OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S7b", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S7b", Math.floor(Date.now() / 1000) + 300);
      writeChangeContract(cwd, {
        allowed_files: ["src/allowed.ts"],
        allowed_new_files: [],
        forbidden_files: ["dist/**"],
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src", "outside.ts"), "export const outside = true;\n", "utf8");

      const result = runHook(cwd, "Edit", join(cwd, "src", "outside.ts"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("CHANGE_CONTRACT_SCOPE");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("src/outside.ts");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows Edit inside the active CHANGE_CONTRACT when exec-window is OPEN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S7c", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S7c", Math.floor(Date.now() / 1000) + 300);
      writeChangeContract(cwd, {
        allowed_files: ["src/allowed.ts"],
        forbidden_files: ["dist/**"],
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, "src", "allowed.ts"), "export const allowed = true;\n", "utf8");

      const result = runHook(cwd, "Edit", join(cwd, "src", "allowed.ts"));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies forbidden_files even when the path is otherwise allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S7d", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S7d", Math.floor(Date.now() / 1000) + 300);
      writeChangeContract(cwd, {
        allowed_files: ["dist/generated.js"],
        forbidden_files: ["dist/**"],
      });
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, "dist", "generated.js"), "export const generated = true;\n", "utf8");

      const result = runHook(cwd, "Edit", join(cwd, "dist", "generated.js"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("forbidden_touched");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("dist/generated.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows read-only Bash regardless of exec-window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "cat src/main.ts" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies file-modifying Bash when exec-window is CLOSED", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8b", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo 'pwned' > src/config.ts" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("CLOSED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies Bash redirection without whitespace (bypass attempt)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8b2", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo x>src/config.ts" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("CLOSED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows file-modifying Bash inside .codex/ regardless of window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8c", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo 'data' > .codex/pipeline/test.json" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies MultiEdit when any path is outside allowed dirs and window is CLOSED", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S10", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "MultiEdit",
          tool_input: { files: [join(cwd, "src", "a.ts"), join(cwd, "src", "b.ts")] },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("CLOSED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows MultiEdit when all paths are inside allowed dirs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S11", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "MultiEdit",
          tool_input: { files: [join(cwd, ".codex", "pipeline", "a.json"), join(cwd, ".codex", "pipeline", "b.json")] },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fail-closed on malformed stdin", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: "not-json",
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fail-closed when session-lock file is corrupted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      const dir = join(cwd, ".codex", "pipeline");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session-lock.json"), "{bad-json", "utf8");

      const result = runHook(cwd, "Edit", join(cwd, "src", "main.ts"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("records observable hook events as JSONL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S9", Math.floor(Date.now() / 1000) + 3600);

      runHook(cwd, "Edit", join(cwd, "src", "main.ts"));

      const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
      expect(existsSync(eventsPath)).toBe(true);
      const lines = readFileSync(eventsPath, "utf8").trim().split("\n");
      const lastEvent = JSON.parse(lines[lines.length - 1]);
      expect(lastEvent).toMatchObject({
        hook: "edit-guard",
        event: "PreToolUse",
        decision: "deny",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses realpath to resolve symlinks before path traversal check", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S10", Math.floor(Date.now() / 1000) + 3600);

      // Create a real target file outside the workspace
      const outsideDir = mkdtempSync(join(tmpdir(), "edit-guard-outside-"));
      const targetFile = join(outsideDir, "secret.txt");
      writeFileSync(targetFile, "secret", "utf8");

      // Create a symlink inside .codex/ that points to the outside file
      const safeDir = join(cwd, ".codex", "pipeline");
      mkdirSync(safeDir, { recursive: true });
      const symlinkPath = join(safeDir, "escape");

      // Windows requires elevated privileges for symlinks; skip if unsupported
      try {
        require("node:fs").symlinkSync(targetFile, symlinkPath, "file");
      } catch {
        // Symlinks not supported in this test environment — skip gracefully
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: `echo pwned > ${symlinkPath}` },
        }),
        encoding: "utf8",
      });

      rmSync(outsideDir, { recursive: true, force: true });

      expect(result.status).toBe(0);
      const stdout = result.stdout.trim();
      if (stdout) {
        const output = JSON.parse(stdout);
        expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
