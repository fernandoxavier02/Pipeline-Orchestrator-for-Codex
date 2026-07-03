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

function writePendingRequiredFirstActions(cwd: string) {
  const dir = join(cwd, ".codex", "pipeline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "required-first-actions.json"), JSON.stringify({
    schema_version: 1,
    status: "active",
    plugin: "pipeline-orchestrator-for-codex",
    workflow: "pipeline",
    required_actions: [
      "update_plan",
      "WORKFLOW_METHOD_GATE",
      "CAPABILITY_GATE",
      "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
      "wait_agent",
    ],
    completed_actions: [],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
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

  it("TDD: denies Edit of canonical pipeline obligation state during an active session", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S3b", Math.floor(Date.now() / 1000) + 3600);

      const result = runHook(cwd, "Edit", join(cwd, ".codex", "pipeline", "workflow-intent.json"));

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("protected pipeline state files");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(".codex/pipeline/workflow-intent.json");
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

  it("TDD: denies read-only Bash during pending first actions and redirects to controller bootstrap", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-first-actions-"));
    try {
      writeSessionLock(cwd, "S8a", Math.floor(Date.now() / 1000) + 3600);
      writePendingRequiredFirstActions(cwd);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "ssh hostinger-vps 'ls /root'" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("required pipeline first actions");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Do not stop");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("pipeline-controller");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies read-only Bash when signed first-actions state was tampered", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-first-actions-hmac-"));
    try {
      writeSessionLock(cwd, "S8a-hmac", Math.floor(Date.now() / 1000) + 3600);
      const dir = join(cwd, ".codex", "pipeline");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "required-first-actions.json"), JSON.stringify({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "pipeline",
        required_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        completed_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        _integrity: {
          algorithm: "hmac-sha256",
          scope: "pipeline-required-first-actions",
          signature: "0".repeat(64),
        },
      }), "utf8");

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "cat src/main.ts" },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          PIPELINE_SENTINEL_HMAC_KEY: "unit-test-hmac-key",
        },
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("required pipeline first actions");
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

  it("TDD: denies file-modifying Bash inside .codex/pipeline/ during active sessions", () => {
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
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(".codex/pipeline");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies node runtime mutations of protected pipeline state through Bash", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8c2", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: {
            command: "node -e \"require('fs').rmSync('.codex/pipeline/workflow-intent.json', {force:true})\"",
          },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(".codex/pipeline");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies Bash deletion of canonical pipeline obligation state even inside .codex/", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8d", Math.floor(Date.now() / 1000) + 3600);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "rm -f .codex/pipeline/required-first-actions.json" },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("protected pipeline state files");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(".codex/pipeline/required-first-actions");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each([
    "rm -f .codex/pipeline/workflow-intent.json;",
    "rm -f .codex/pipeline/required-first-actions.json && echo done",
    "rm -f .codex/pipeline/sentinel-state.json || true",
    "rm -f .codex/pipeline/session-lock.json\nrm -f .codex/pipeline/workflow-intent.json",
    "echo '{}' > .codex/pipeline/required-first-actions.json;",
    "rm -f .codex/pipeline/workflow-intent.*",
    "rm -f .codex/pipeline/{workflow-intent,required-first-actions}.json",
    "rm -f .CODEX/pipeline/SENTINEL-STATE.*",
    "echo '{}' > .codex/pipeline/session-lock.*",
    "DIR=.codex/pipeline; BASE=workflow; rm -f \"$DIR/$BASE-intent.json\"",
    "DIR=.codex/pipeline; BASE=required-first; rm -f \"$DIR/$BASE-actions.json\"",
    "DIR=.codex/pipeline; BASE=sentinel; rm -f \"$DIR/$BASE-state.json\"",
    "DIR=.codex/pipeline; BASE=session; rm -f \"$DIR/$BASE-lock.json\"",
  ])("TDD: denies Bash protected state mutation with shell separator %#", (command) => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-hook-"));
    try {
      writeSessionLock(cwd, "S8e", Math.floor(Date.now() / 1000) + 3600);
      writeExecWindow(cwd, "S8e", Math.floor(Date.now() / 1000) + 300);

      const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
        }),
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("protected pipeline state files");
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

  // --- Batch 3: escape-route allowlist + surgical write-detection fixes ---

  const RESET_SCRIPT_ABS = join(ROOT, "scripts", "pipeline-reset.cjs");
  const OPEN_SCRIPT_ABS = join(ROOT, "scripts", "exec-window", "open.cjs");

  function runBash(cwd: string, command: string, env?: Record<string, string>) {
    return spawnSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
      env: env ? { ...process.env, ...env } : process.env,
    });
  }

  function isDeny(result: ReturnType<typeof runBash>): boolean {
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    if (!stdout) return false;
    const output = JSON.parse(stdout);
    return output?.hookSpecificOutput?.permissionDecision === "deny";
  }

  // Codex sets PLUGIN_ROOT to where the plugin (and its escape scripts) live,
  // which is not the workspace cwd. Model that so the allowlist resolves.
  const PLUGIN_ENV = { PLUGIN_ROOT: ROOT };

  it("allows the pipeline-reset escape script even when exec-window is CLOSED", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-escape-"));
    try {
      writeSessionLock(cwd, "E1", Math.floor(Date.now() / 1000) + 3600);
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}"`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows the pipeline-reset escape script even while required first actions are pending", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-escape-"));
    try {
      writeSessionLock(cwd, "E2", Math.floor(Date.now() / 1000) + 3600);
      writePendingRequiredFirstActions(cwd);
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}"`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows the pipeline-reset escape script even under a corrupted (tampered) session lock", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-escape-"));
    try {
      const dir = join(cwd, ".codex", "pipeline");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session-lock.json"), "{bad-json", "utf8");
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}"`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows exec-window/open.cjs under a normal pending bootstrap", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-escape-"));
    try {
      writeSessionLock(cwd, "E3", Math.floor(Date.now() / 1000) + 3600);
      writePendingRequiredFirstActions(cwd);
      const result = runBash(cwd, `node "${OPEN_SCRIPT_ABS}"`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies exec-window/open.cjs when first-actions state is tampered", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-escape-"));
    try {
      writeSessionLock(cwd, "E4", Math.floor(Date.now() / 1000) + 3600);
      const dir = join(cwd, ".codex", "pipeline");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "required-first-actions.json"), JSON.stringify({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "pipeline",
        required_actions: ["update_plan"],
        completed_actions: ["update_plan"],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        _integrity: { algorithm: "hmac-sha256", scope: "pipeline-required-first-actions", signature: "0".repeat(64) },
      }), "utf8");
      const result = runBash(cwd, `node "${OPEN_SCRIPT_ABS}"`, { ...PLUGIN_ENV, PIPELINE_SENTINEL_HMAC_KEY: "unit-test-hmac-key" });
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F1: denies a chained payload behind the reset escape (lone & background)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f1-"));
    try {
      writeSessionLock(cwd, "F1", Math.floor(Date.now() / 1000) + 3600);
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}" & rm -rf x`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F2: denies quoted write verbs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f2-"));
    try {
      writeSessionLock(cwd, "F2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `"cp" src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `'mv' src/a src/b`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F3: denies wrapper-with-flag that hides the write verb", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f3-"));
    try {
      writeSessionLock(cwd, "F3", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `env -i cp src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `sudo -u root cp src/a src/b`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F4: denies bash -c / sh -c wrapping a write verb", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f4-"));
    try {
      writeSessionLock(cwd, "F4", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `bash -c "cp src/a src/b"`))).toBe(true);
      expect(isDeny(runBash(cwd, `sh -c "mv src/a src/b"`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F5: catches var=>file redirect; unquoted arrows are real POSIX redirects", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f5-"));
    try {
      writeSessionLock(cwd, "F5", Math.floor(Date.now() / 1000) + 3600);
      // Real redirect masquerading as an arrow.
      expect(isDeny(runBash(cwd, `foo=>src/outfile`))).toBe(true);
      // C2: `x => y` / `x -> y` are NOT arrow escapes — in POSIX the `>` is a
      // real redirect. Only a QUOTED arrow is inert data.
      expect(isDeny(runBash(cwd, `echo x -> y`))).toBe(true);
      expect(isDeny(runBash(cwd, `echo x => y`))).toBe(true);
      expect(isDeny(runBash(cwd, `echo "x => y"`))).toBe(false);
      expect(isDeny(runBash(cwd, `git commit -m "a->b"`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F7: denies the reset escape carrying a trailing redirection", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-f7-"));
    try {
      writeSessionLock(cwd, "F7", Math.floor(Date.now() / 1000) + 3600);
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}" > src/evil`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("anti-regression: echo of a write-verb string is allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-ar1-"));
    try {
      writeSessionLock(cwd, "AR1", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `echo "mv a b"`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("anti-regression: package-manager install is allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-ar2-"));
    try {
      writeSessionLock(cwd, "AR2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `npm install`))).toBe(false);
      expect(isDeny(runBash(cwd, `pip3 install requests`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("anti-regression: read-only Bash mentioning .codex/pipeline is allowed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-ar4-"));
    try {
      writeSessionLock(cwd, "AR4", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `cat .codex/pipeline/sentinel-state.json`))).toBe(false);
      expect(isDeny(runBash(cwd, `grep foo .codex/pipeline/sentinel-state.json`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still denies interpreter-based deletes of protected state (no read-only bypass)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-interp-"));
    try {
      writeSessionLock(cwd, "INTERP", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `python -c "import os; os.remove('.codex/pipeline/session-lock.json')"`))).toBe(true);
      expect(isDeny(runBash(cwd, `ruby -e "File.delete('.codex/pipeline/sentinel-state.json')"`))).toBe(true);
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

  // --- Batch 3 redo: C1/C2/I1/I2 + minors ---

  it("C1: NEWLINE is a separator — payload after the reset escape is denied", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-c1-"));
    try {
      writeSessionLock(cwd, "C1", Math.floor(Date.now() / 1000) + 3600);
      // Escape script on line 1, destructive payload on line 2 (no separator token).
      const result = runBash(cwd, `node "${RESET_SCRIPT_ABS}"\nrm -rf x`, PLUGIN_ENV);
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("C1: NEWLINE-smuggled redirect into protected state behind the escape is denied", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-c1b-"));
    try {
      writeSessionLock(cwd, "C1b", Math.floor(Date.now() / 1000) + 3600);
      const result = runBash(
        cwd,
        `node "${RESET_SCRIPT_ABS}"\necho x > .codex/pipeline/session-lock.json`,
        PLUGIN_ENV,
      );
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("C2: unquoted arrows are real redirects and are denied", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-c2-"));
    try {
      writeSessionLock(cwd, "C2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `echo PWNED => src/config.ts`))).toBe(true);
      expect(isDeny(runBash(cwd, `echo x -> src/config.ts`))).toBe(true);
      expect(isDeny(runBash(cwd, `foo=> file`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("C2 (root): a real `>` outside quotes is a redirect even when `\"` appear inside UNRELATED single-quoted regions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-c2-root-"));
    try {
      writeSessionLock(cwd, "C2r", Math.floor(Date.now() / 1000) + 3600);
      // The `>` is OUTSIDE every quote. The backslash-blind regex used to pair
      // the `"` in `'say "hi'` with the `"` in `'there"'` and swallow the `>`.
      expect(isDeny(runBash(cwd, `echo 'say "hi' > src/config.ts 'there"'`))).toBe(true);
      expect(isDeny(runBash(cwd, `echo 'say "x' > .codex/pipeline/session-lock.json 'y"'`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("I2 (root): quote-adjacency obfuscated write verbs collapse to the bare verb", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-i2-root-"));
    try {
      writeSessionLock(cwd, "I2r", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `"c"p src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `c"p" src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `\\c\\p src/a src/b`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ARCH-M3 (root): an escaped inner quote does NOT truncate an interpreter code payload", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-m3-root-"));
    try {
      writeSessionLock(cwd, "M3r", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(
        cwd,
        `python3 -c "note = \\"hi\\" + os.remove('.codex/pipeline/session-lock.json')"`,
      ))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("I1: refuses the escape allowlist when pipeline-reset.cjs resolves through a symlink", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-i1-"));
    const fakeRoot = mkdtempSync(join(tmpdir(), "edit-guard-i1-root-"));
    try {
      // Pending first-actions blocks ALL bash unless the escape route matches;
      // that is exactly when a spoofed allowlist entry would grant RCE.
      writeSessionLock(cwd, "I1", Math.floor(Date.now() / 1000) + 3600);
      writePendingRequiredFirstActions(cwd);
      const evil = join(fakeRoot, "evil.cjs");
      writeFileSync(evil, "process.exit(0);\n", "utf8");
      mkdirSync(join(fakeRoot, "scripts"), { recursive: true });
      const linkPath = join(fakeRoot, "scripts", "pipeline-reset.cjs");
      try {
        require("node:fs").symlinkSync(evil, linkPath, "file");
      } catch {
        // Symlinks unsupported in this environment — skip gracefully.
        return;
      }
      const result = runBash(cwd, `node "${linkPath}"`, { PLUGIN_ROOT: fakeRoot });
      expect(isDeny(result)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("I2: empty-quote / $'...' obfuscated write verbs are denied", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-i2-"));
    try {
      writeSessionLock(cwd, "I2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `c""p src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `c''p src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `$'cp' src/a src/b`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("M1: `install` only fires as a command verb, not as a substring argument", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-m1-"));
    try {
      writeSessionLock(cwd, "M1", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `cat install.md`))).toBe(false);
      expect(isDeny(runBash(cwd, `npm run install-deps`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("M2: sed --in-place is treated as a write and requires a window", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-m2-"));
    try {
      writeSessionLock(cwd, "M2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `sed --in-place s/a/b/ src/config.ts`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ARCH-M3: a write verb inside a quoted DATA argument is inert, but bash -c code still fires", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-m3-"));
    try {
      writeSessionLock(cwd, "M3", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `git commit -m "cp helper"`))).toBe(false);
      expect(isDeny(runBash(cwd, `bash -c "cp src/a src/b"`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // --- Batch 3 redo attempt 3: residual scanSegment bypasses (ADV-1/2/3) ---

  it("ADV-1: ANSI-C $'...' quoting does not desync the scanner and hide a redirect", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-adv1-"));
    try {
      writeSessionLock(cwd, "ADV1", Math.floor(Date.now() / 1000) + 3600);
      // `$'\''` is an ANSI-C string: the `\'` is an escaped quote (keeps the
      // string OPEN), then the final `'` closes it — so the `>` that follows is
      // a REAL redirect. The old SINGLE-mode scanner mis-closed early and
      // re-opened a quote, swallowing the `>`.
      expect(isDeny(runBash(cwd, `echo $'\\'' > src/config.ts`))).toBe(true);
      expect(isDeny(runBash(cwd, `echo $'\\'' > .codex/pipeline/session-lock.json`))).toBe(true);
      // Control: a plain unquoted redirect must still be denied.
      expect(isDeny(runBash(cwd, `echo x > src/config.ts`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ADV-2: a write verb obfuscated behind an argv-transparent wrapper is denied", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-adv2-"));
    try {
      writeSessionLock(cwd, "ADV2", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `sudo "c"p src/a src/b`))).toBe(true);
      expect(isDeny(runBash(cwd, `env \\c\\p src/a src/b`))).toBe(true);
      // Regression: a quoted DATA arg after a real command stays inert.
      expect(isDeny(runBash(cwd, `git commit -m "cp helper"`))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ADV-3: attached interpreter code-flag forms are captured and scanned", () => {
    const cwd = mkdtempSync(join(tmpdir(), "edit-guard-adv3-"));
    try {
      writeSessionLock(cwd, "ADV3", Math.floor(Date.now() / 1000) + 3600);
      expect(isDeny(runBash(cwd, `bash -c"cp src/a src/b"`))).toBe(true);
      expect(isDeny(runBash(cwd, `node --eval="fs.rmSync('x')"`))).toBe(true);
      expect(isDeny(runBash(cwd, `python -c"open('f','w')"`))).toBe(true);
      // Regression: the space forms already worked and must keep working.
      expect(isDeny(runBash(cwd, `bash -c "cp x y"`))).toBe(true);
      expect(isDeny(runBash(cwd, `node -e "fs.rmSync(x)"`))).toBe(true);
      expect(isDeny(runBash(cwd, `python -c "open('f','w')"`))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
