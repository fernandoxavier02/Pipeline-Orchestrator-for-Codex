import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";

function stores() {
  return {
    session: { load: async () => undefined, save: async () => undefined },
    checkpoints: { list: async () => [], save: async () => undefined },
    gateLog: { append: async () => undefined, list: async () => [] },
    confidence: { save: async () => undefined },
    sentinel: { save: async () => undefined },
  };
}

function completeAgentRuntime() {
  return {
    capabilities: {
      spawnAgent: true,
      waitAgent: true,
      collectArtifacts: true,
      recordGates: true,
      recordCheckpoints: true,
      structuredFinalState: true,
    },
    async spawnAgent(request: any) {
      return {
        mode: "single-agent" as const,
        role: request.role,
        output: { status: "approved" },
      };
    },
    async waitAgent(dispatch: any) {
      return dispatch;
    },
    async collectArtifacts(dispatches: any[]) {
      return dispatches.map((dispatch) => dispatch.output);
    },
  };
}

describe("pipeline capability gate", () => {
  it("blocks explicit public pipeline requests before inline classification when runtime is incomplete", async () => {
    const controller = createPipelineController({
      strictAgents: true,
      stores: stores(),
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:pipeline review this diff adversarially",
    );

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      pipeline_valid: false,
      blockedBy: "CAPABILITY_GATE",
      manual_fallback_counts_as_pipeline: false,
    });
    expect(result.missing_capabilities).toContain("spawn_agent");
    expect(result.gates[0]).toMatchObject({
      gate: "CAPABILITY_GATE",
      status: "BLOCKED",
    });
  });

  it("does not treat an executionController mock as a real agent runtime", async () => {
    const controller = createPipelineController({
      strictAgents: true,
      stores: stores(),
      executionController: {
        executeApprovedWork: async () => ({ status: "completed" }),
      },
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:pipeline fix execution governance",
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockedBy).toBe("CAPABILITY_GATE");
    expect(result.missing_capabilities).toContain("spawn_agent");
  });

  it("defaults explicit public pipeline requests to fail closed when strictAgents is undefined", async () => {
    const controller = createPipelineController({
      stores: stores(),
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:pipeline run adversarial review",
    );

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      pipeline_valid: false,
      blockedBy: "CAPABILITY_GATE",
    });
    expect(result.missing_capabilities).toContain("spawn_agent");
    expect(result.manual_fallback_counts_as_pipeline).toBe(false);
  });

  it("blocks explicit public pipeline requests even when strictAgents is false", async () => {
    const controller = createPipelineController({
      strictAgents: false,
      stores: stores(),
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:pipeline run adversarial review",
    );

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      pipeline_valid: false,
      blockedBy: "CAPABILITY_GATE",
    });
    expect(result.missing_capabilities).toContain("spawn_agent");
  });

  it("blocks direct workflow shortcut requests before proposal flow when runtime is incomplete", async () => {
    const controller = createPipelineController({
      strictAgents: true,
      stores: stores(),
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:audit review governance",
    );

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      blockedBy: "CAPABILITY_GATE",
      pipeline_valid: false,
    });
  });

  it("allows proposal flow only when the explicit pipeline has complete runtime capabilities", async () => {
    const controller = createPipelineController({
      strictAgents: true,
      stores: stores(),
      agentRuntime: completeAgentRuntime(),
      executionController: {
        executeApprovedWork: async () => ({ status: "completed" }),
      },
    });

    const result = await controller.start(
      "/pipeline-orchestrator-for-codex:pipeline audit workflow gates",
    );

    expect(result.status).not.toBe("BLOCKED");
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
    expect(result.gates[0]).toMatchObject({
      gate: "CAPABILITY_GATE",
      status: "PASS",
    });
  });
});
