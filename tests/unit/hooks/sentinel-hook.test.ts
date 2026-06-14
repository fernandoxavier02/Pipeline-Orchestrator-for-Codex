import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "sentinel-hook.cjs");

function runSentinelHook(cwd: string, subagentType: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      tool_input: {
        subagent_type: subagentType,
      },
    }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function runSentinelHookForSpawnAgent(cwd: string, message: string) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      tool_name: "spawn_agent",
      tool_input: {
        agent_type: "worker",
        message,
      },
    }),
    encoding: "utf8",
  });
}

function writeRuntimeSentinelState(
  cwd: string,
  expectedNext: string[],
  overrides: Record<string, unknown> = {},
) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "sentinel-state.json"), JSON.stringify({
    pipelineActive: true,
    currentPhase: "phase-1",
    currentAgent: "pipeline-controller",
    expectedNext,
    completedPhases: ["phase-0"],
    gateSummary: ["SENTINEL_CHECKPOINT"],
    batchState: {
      batchIndex: 0,
      status: "awaiting-proposal-confirmation",
    },
    consecutiveCorrections: 0,
    lastCheckpoint: "post_orchestrator",
    updatedAt: new Date().toISOString(),
    ...overrides,
  }), "utf8");
}

function writeActiveSessionLock(cwd: string, overrides: Record<string, unknown> = {}) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "session-lock.json"), JSON.stringify({
    session_id: "sentinel-session",
    run_id: "sentinel-run",
    status: "active",
    created_at: Math.floor(Date.now() / 1000) - 10,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  }), "utf8");
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function signState(state: Record<string, unknown>, key: string) {
  return crypto.createHmac("sha256", key).update(canonicalize(state)).digest("hex");
}

function writeSignedRuntimeSentinelState(
  cwd: string,
  expectedNext: string[],
  key: string,
  overrides: Record<string, unknown> = {},
) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  const state = {
    pipelineActive: true,
    currentPhase: "phase-1",
    currentAgent: "pipeline-controller",
    expectedNext,
    completedPhases: ["phase-0"],
    gateSummary: ["SENTINEL_CHECKPOINT"],
    batchState: {
      batchIndex: 0,
      status: "awaiting-proposal-confirmation",
    },
    consecutiveCorrections: 0,
    lastCheckpoint: "post_orchestrator",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  const signedState = {
    ...state,
    _integrity: {
      algorithm: "hmac-sha256",
      signature: signState(state, key),
    },
  };
  writeFileSync(join(stateDir, "sentinel-state.json"), JSON.stringify(signedState), "utf8");
}

function runSentinelHookRaw(cwd: string, rawInput: string) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: rawInput,
    encoding: "utf8",
  });
}

describe("sentinel hook", () => {
  // R11 AC 11.2, 11.4 — sanitized canonical reason; details stay in stderr.
  it("denies on malformed stdin JSON with sanitized reason (fail-closed)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHookRaw(cwd, "not-json{{{");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
  });

  // Post-review regression (SEC-001): divergence branch MUST NOT leak the
  // state_file_path into the user-visible permissionDecisionReason. Path
  // remains in stderr only.
  it("SEC-001: divergence branch does not leak state_file_path into user-visible reason", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["expected-next-agent"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:diverging-agent");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("SENTINEL DIVERGENCE");
    // The path MUST NOT appear in the LLM-visible reason.
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain(".codex");
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain("sentinel-state.json");
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain(cwd);
  });

  // Post-review (SEC-002): the suffix-match check is now scoped to the leaf
  // (`target`) instead of the full FQN (`fullAgentType`). For realistic input
  // shapes the namespace prefix check (line 144) already shields against
  // cross-namespace bypass, so this is a defense-in-depth tightening. This
  // test pins the legitimate suffix-alias case to ensure the narrowing did
  // not regress allowed dispatches.
  it("SEC-002: leaf-scoped suffix matching still allows a legitimate alias", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    // Expected token is a suffix-substring of the actual leaf.
    writeRuntimeSentinelState(cwd, ["gate"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");
    expect(result.status).toBe(0);
    // No JSON output means silent allow (default exit-0 with empty stdout).
    expect(result.stdout.trim()).toBe("");
  });

  it("denies on corrupted sentinel-state.json with sanitized reason (fail-closed)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "sentinel-state.json"), "{bad-json", "utf8");

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
    // R11 AC 11.4 — the state file path MUST NOT leak into the user-facing reason.
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain(stateDir);
    expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain("sentinel-state.json");
  });

  it("allows bootstrap task-orchestrator even with corrupted state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "sentinel-state.json"), "{bad-json", "utf8");

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:task-orchestrator");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("denies corrupted sentinel state when an explicit pipeline lock is active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeActiveSessionLock(cwd);
    writeFileSync(join(stateDir, "sentinel-state.json"), "{bad-json", "utf8");

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:task-orchestrator");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
  });

  it("denies inactive sentinel state when an explicit pipeline lock is active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeActiveSessionLock(cwd);
    writeRuntimeSentinelState(cwd, ["information-gate"], { pipelineActive: false });

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("inactive");
  });

  it("denies incompatible sentinel schema when an explicit pipeline lock is active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeActiveSessionLock(cwd);
    writeRuntimeSentinelState(cwd, ["information-gate"], { schema_version: 2 });

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("schema");
  });

  it("denies missing expectedNext when an explicit pipeline lock is active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeActiveSessionLock(cwd);
    writeRuntimeSentinelState(cwd, []);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("expectedNext");
  });

  it("allows a pipeline agent that matches runtime camelCase expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  it("denies unsigned sentinel state when HMAC integrity is required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHook(
      cwd,
      "pipeline-orchestrator-for-codex:core:information-gate",
      { PIPELINE_SENTINEL_HMAC_KEY: "test-key" },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
  });

  it("allows signed sentinel state when HMAC integrity is required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeSignedRuntimeSentinelState(cwd, ["information-gate"], "test-key");

    const result = runSentinelHook(
      cwd,
      "pipeline-orchestrator-for-codex:core:information-gate",
      { PIPELINE_SENTINEL_HMAC_KEY: "test-key" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  it("allows a Codex spawn_agent payload that matches runtime expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHookForSpawnAgent(
      cwd,
      [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
        "Ask one question at a time.",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  it("denies a Codex spawn_agent payload that diverges from runtime expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHookForSpawnAgent(
      cwd,
      [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:executor:executor-controller",
        "Execute the batch.",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Expected");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("information-gate");
  });

  it("denies a pipeline agent that diverges from runtime camelCase expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:executor:executor-controller");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Expected");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("information-gate");
  });

  it("denies pipeline-controller bootstrap when an active sentinel is fresh and awaiting a response", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["proposal-response"]);

    const result = runSentinelHookForSpawnAgent(
      cwd,
      [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
        "Start a new pipeline.",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("proposal-response");
  });

  it("allows stale pipeline-controller bootstrap without disabling active non-stale sequence checks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["proposal-response"], {
      updatedAt: new Date(Date.now() - 301_000).toISOString(),
      batchState: {
        batchIndex: 0,
        status: "awaiting-proposal-confirmation",
      },
    });

    const result = runSentinelHookForSpawnAgent(
      cwd,
      [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
        "Start a new approved bugfix-heavy pipeline.",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(output.hookSpecificOutput.additionalContext).toContain("stale");

    const state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "sentinel-state.json"), "utf8"));
    expect(state.pipelineActive).toBe(true);
    expect(state.expectedNext).toEqual(["proposal-response"]);

    const gateLog = readFileSync(join(cwd, ".codex", "pipeline", "gate-decisions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(gateLog).toHaveLength(1);
    expect(gateLog[0]).toMatchObject({
      gate: "BOOTSTRAP_EXEMPTION_USED",
      hardness: "AUDIT",
      phase: "phase-1",
      decision: "pass",
      decided_by: "system",
    });
  });

  it("denies stale pipeline-controller bootstrap outside the phase-1 proposal-response recovery shape", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["final-validator"], {
      currentPhase: "phase-3",
      updatedAt: new Date(Date.now() - 301_000).toISOString(),
      batchState: {
        batchIndex: 0,
        status: "awaiting-final-validation",
      },
    });

    const result = runSentinelHookForSpawnAgent(
      cwd,
      [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
        "Start a new pipeline.",
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("final-validator");
  });

  it("continues to deny non-controller divergence even when sentinel state is stale", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["proposal-response"], {
      updatedAt: new Date(Date.now() - 301_000).toISOString(),
    });

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:executor:executor-controller");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("proposal-response");
  });

  it("records observable hook events as JSONL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const event = JSON.parse(readFileSync(eventsPath, "utf8").trim());
    expect(event).toMatchObject({
      hook: "sentinel",
      event: "PreToolUse",
      decision: "allow",
      attempted: "information-gate",
      expected: "information-gate",
    });
  });
});
