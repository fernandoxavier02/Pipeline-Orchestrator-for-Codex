/**
 * Feature: Dispatch protection (B3 — dispatch-guard)
 *
 * Pipeline agents must be invoked via Agent with the codex namespace FQN.
 * Calls via Skill or via Agent without the namespace must be denied.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = join(process.cwd(), "hooks", "dispatch-guard.cjs");

type HookOutput = {
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
  };
};

function runHook(payload: Record<string, unknown>): HookOutput {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `dispatch-guard exited with ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  const stdout = (result.stdout || "").trim();
  if (!stdout) return {};
  return JSON.parse(stdout) as HookOutput;
}

describe("Feature: dispatch-guard enforces the pipeline namespace", () => {
  it("Scenario: Agent call with the codex FQN is allowed", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "pipeline-orchestrator-for-codex:core:task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("Scenario: documented pipeline-controller Agent FQN is allowed", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "pipeline-orchestrator-for-codex:core:pipeline-controller" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("Scenario: Spec lifecycle Agent calls with codex FQNs are allowed", () => {
    for (const leaf of ["spec-format-gate", "spec-content-reviewer", "spec-post-impl-validator", "spec-closer"]) {
      const out = runHook({
        tool_name: "Agent",
        tool_input: { subagent_type: `pipeline-orchestrator-for-codex:quality:${leaf}` },
      });
      expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
    }
  });

  it("Scenario: Agent call with bare leaf is denied with FQN hint", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain(
      "pipeline-orchestrator-for-codex:core:task-orchestrator",
    );
  });

  it("Scenario: Agent call with forged codex folder is denied", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "pipeline-orchestrator-for-codex:wrong-folder:task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("expected canonical FQN");
  });

  it("Scenario: Agent call with legacy pipeline namespace is denied", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "pipeline-orchestrator:core:task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("Use pipeline-orchestrator-for-codex");
  });

  it("Scenario: Agent call with the wrong (non-codex) namespace is allowed (other plugin)", () => {
    const out = runHook({
      tool_name: "Agent",
      tool_input: { subagent_type: "some-other-plugin:foo:task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("Scenario: Skill call mapping to a pipeline agent leaf is denied", () => {
    const out = runHook({
      tool_name: "Skill",
      tool_input: { skill: "task-orchestrator" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("spawn_agent");
  });

  it("Scenario: Skill call to a non-pipeline skill is allowed", () => {
    const out = runHook({
      tool_name: "Skill",
      tool_input: { skill: "context" },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
});
