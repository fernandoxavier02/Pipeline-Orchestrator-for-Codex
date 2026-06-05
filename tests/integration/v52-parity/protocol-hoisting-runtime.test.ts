import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import * as dispatchRunRoleModule from "../../../src/dispatcher/run-role.js";
import { createExecutionIdentity } from "../../../src/observability/execution-identity.js";

describe("v5.2 protocol hoisting runtime", () => {
  it("persists documented protocol blocks emitted by a dispatched role", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const executionIdentity = createExecutionIdentity({
      surface: "test",
      cwd: root,
      stateRoot: runtime.stateDir,
      source: "test",
    });
    const runRoleSpy = vi.spyOn(dispatchRunRoleModule, "runRole").mockResolvedValue({
      mode: "single-agent",
      role: "brainstorm-controller",
      executionIdentity,
      output: {
        text: `=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q1
question: What is the scope?
header: Scope
options:
  - label: Narrow
    description: Keep the first batch small.
    recommended: true
  - label: Broaden
    description: Include adjacent decisions before planning.
    recommended: false
=== END GATE_REQUEST ===`,
        executionIdentity,
      },
    });

    try {
      const result = await runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "brainstorm-controller",
        prompt: "Run brainstorm.",
        input: {},
      });

      expect(result.output.protocolStatus).toBe("awaiting-parent-action");
      expect(result.output.protocolEvents).toEqual([
        { kind: "GATE_REQUEST", id: "brainstorm-explore-q1" },
      ]);
      const raw = await readFile(join(runtime.stateDir, "protocol-events.jsonl"), "utf8");
      expect(raw).toContain("\"kind\":\"GATE_REQUEST\"");
      expect(raw).toContain("\"gate_id\":\"brainstorm-explore-q1\"");
    } finally {
      runRoleSpy.mockRestore();
    }
  });

  it("blocks pipeline completion when protocol blocks are awaiting parent action", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const executionIdentity = createExecutionIdentity({
      surface: "test",
      cwd: root,
      stateRoot: runtime.stateDir,
      source: "test",
    });
    const runRoleSpy = vi.spyOn(dispatchRunRoleModule, "runRole").mockResolvedValue({
      mode: "single-agent",
      role: "pipeline-controller",
      executionIdentity,
      output: {
        text: `PIPELINE COMPLETE

=== GATE_REQUEST v1 ===
gate_id: phase-2-adversarial-batch-1
question: Continue after adversarial review?
header: Review
options:
  - label: Continue
    description: Accept the current batch and advance.
    recommended: true
  - label: Block
    description: Stop until findings are corrected.
    recommended: false
=== END GATE_REQUEST ===`,
        executionIdentity,
      },
    });

    try {
      const result = await runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "pipeline-controller",
        prompt: "Run full pipeline.",
        input: {},
      });

      expect(result.output.status).toBe("blocked");
      expect(result.output.protocolStatus).toBe("blocked-awaiting-parent-action");
      expect(result.output.text).toContain("BLOCKED");
      expect(String(result.output.attemptedOutputText)).toContain("PIPELINE COMPLETE");
    } finally {
      runRoleSpy.mockRestore();
    }
  });

  it("processes DISPATCH_REQUEST blocks through the injected real agent adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const calls: string[] = [];
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
      strictAgents: true,
      agentRuntime: {
        async spawnAgent(request) {
          calls.push(request.role);
          if (request.role === "pipeline-controller") {
            return {
              mode: "single-agent",
              role: request.role,
              output: {
                text: `=== DISPATCH_REQUEST v1 ===
dispatch_id: dispatch-info-gate
target_kind: agent
target_name: information-gate
description: Ask one missing-information question.
prompt: Ask one question at a time.
phase: phase-0
=== END DISPATCH_REQUEST ===`,
              },
            };
          }

          return {
            mode: "single-agent",
            role: request.role,
            output: {
              status: "approved",
              text: "INFORMATION_GATE\nSTATUS: passed",
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-0",
      prompt: "Start operational pipeline.",
      input: { request: "/pipeline-orchestrator-for-codex:pipeline audit current workflow execution" },
      requireRealAgent: true,
      freshContext: true,
    });

    expect(calls).toEqual(["pipeline-controller", "information-gate"]);
    expect(result.output.protocolStatus).toBe("parent-dispatch-completed");
    expect(result.output.parentDispatchResults).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-info-gate",
        targetName: "information-gate",
      }),
    ]);
    const raw = await readFile(join(runtime.stateDir, "protocol-events.jsonl"), "utf8");
    expect(raw).toContain("\"status\":\"completed\"");
    expect(raw).toContain("\"targetName\":\"information-gate\"");
  });

  it("processes dispatch blocks from mixed protocol output while keeping gates pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const calls: string[] = [];
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
      strictAgents: true,
      agentRuntime: {
        async spawnAgent(request) {
          calls.push(request.role);
          if (request.role === "pipeline-controller") {
            return {
              mode: "single-agent",
              role: request.role,
              output: {
                text: `=== DISPATCH_REQUEST v1 ===
dispatch_id: dispatch-info-gate
target_kind: agent
target_name: information-gate
description: Ask one missing-information question.
prompt: Ask one question at a time.
phase: phase-0
=== END DISPATCH_REQUEST ===

=== GATE_REQUEST v1 ===
gate_id: phase-2-adversarial-batch-1
question: Continue?
header: Review
options:
  - label: Continue
    description: Continue after review.
    recommended: true
  - label: Block
    description: Stop for fixes.
    recommended: false
=== END GATE_REQUEST ===`,
              },
            };
          }

          return {
            mode: "single-agent",
            role: request.role,
            output: {
              status: "approved",
              text: "INFORMATION_GATE\nSTATUS: passed",
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-0",
      prompt: "Start operational pipeline.",
      input: { request: "/pipeline-orchestrator-for-codex:pipeline audit current workflow execution" },
      requireRealAgent: true,
      freshContext: true,
    });

    expect(calls).toEqual(["pipeline-controller", "information-gate"]);
    expect(result.output.protocolStatus).toBe("awaiting-parent-action");
    expect(result.output.parentDispatchResults).toEqual([
      expect.objectContaining({ dispatchId: "dispatch-info-gate" }),
    ]);
    expect(result.output.protocolEvents).toEqual([
      { kind: "GATE_REQUEST", id: "phase-2-adversarial-batch-1" },
    ]);
  });

  it("blocks brainstorm completion when no interactive gate was emitted or answered", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const executionIdentity = createExecutionIdentity({
      surface: "test",
      cwd: root,
      stateRoot: runtime.stateDir,
      source: "test",
    });
    const runRoleSpy = vi.spyOn(dispatchRunRoleModule, "runRole").mockResolvedValue({
      mode: "single-agent",
      role: "brainstorm-controller",
      executionIdentity,
      output: {
        text: "BRAINSTORM PIPELINE COMPLETE\nI generated the workflows and decisions without asking anything.",
        executionIdentity,
      },
    });

    try {
      const result = await runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "brainstorm-controller",
        prompt: "Run brainstorm.",
        input: {},
      });

      expect(result.output.status).toBe("blocked");
      expect(result.output.protocolStatus).toBe("blocked-missing-brainstorm-gate");
      expect(result.output.text).toContain("BLOCKED");
      expect(String(result.output.attemptedOutputText)).toContain("BRAINSTORM PIPELINE COMPLETE");
    } finally {
      runRoleSpy.mockRestore();
    }
  });

  it("allows brainstorm completion after GATE_RESPONSES are present", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const executionIdentity = createExecutionIdentity({
      surface: "test",
      cwd: root,
      stateRoot: runtime.stateDir,
      source: "test",
    });
    const runRoleSpy = vi.spyOn(dispatchRunRoleModule, "runRole").mockResolvedValue({
      mode: "single-agent",
      role: "brainstorm-controller",
      executionIdentity,
      output: {
        text: "BRAINSTORM PIPELINE COMPLETE\nAnswers recorded.",
        executionIdentity,
      },
    });

    try {
      const result = await runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "brainstorm-controller",
        prompt: "GATE_RESPONSES:\n  brainstorm-explore-q1:\n    selected_label: Narrow\n\nRun brainstorm.",
        input: {},
      });

      expect(result.output.status).not.toBe("blocked");
      expect(result.output.text).toContain("BRAINSTORM PIPELINE COMPLETE");
    } finally {
      runRoleSpy.mockRestore();
    }
  });
});
