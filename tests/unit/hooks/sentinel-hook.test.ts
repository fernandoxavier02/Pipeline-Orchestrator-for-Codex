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

describe("sentinel hook", () => {
  it("allows a pipeline agent that matches runtime camelCase expectedNext", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-sentinel-hook-"));
    writeRuntimeSentinelState(cwd, ["information-gate"]);

    const result = runSentinelHook(cwd, "pipeline-orchestrator-for-codex:core:information-gate");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
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
