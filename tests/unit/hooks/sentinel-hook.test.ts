import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "sentinel-hook.cjs");

function runSentinelHook(cwd: string, subagentType: string) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      tool_input: {
        subagent_type: subagentType,
      },
    }),
    encoding: "utf8",
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

function writeRuntimeSentinelState(cwd: string, expectedNext: string[]) {
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
  }), "utf8");
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

  it("allows a pipeline agent that matches runtime camelCase expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

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
