import { describe, expect, it } from "vitest";
import {
  MANUAL_FALLBACK_NOTICE,
  REQUIRED_PIPELINE_GATES,
  REQUIRED_PIPELINE_HOOKS,
  createBlockedPipelineArtifact,
  createPassingPipelineArtifact,
  evaluateCapabilities,
  validatePipelineArtifact,
} from "../../../src/governance/pipeline-contract.js";

function completeRuntime() {
  return {
    agentRuntime: {
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
    },
    stores: {
      gateLog: { append: async () => undefined },
      checkpoints: { save: async () => undefined },
    },
  };
}

describe("pipeline governance contract", () => {
  it("blocks when spawn_agent and wait_agent capabilities are absent", () => {
    const result = evaluateCapabilities();

    expect(result.status).toBe("BLOCKED");
    expect(result.missing_capabilities).toContain("spawn_agent");
    expect(result.missing_capabilities).toContain("wait_agent");
  });

  it("blocks an adapter that exposes spawnAgent without waitAgent", () => {
    const result = evaluateCapabilities({
      agentRuntime: {
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: { status: "approved" },
          };
        },
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.missing_capabilities).not.toContain("spawn_agent");
    expect(result.missing_capabilities).toContain("wait_agent");
  });

  it("blocks an adapter that only self-declares wait and artifact capabilities", () => {
    const result = evaluateCapabilities({
      agentRuntime: {
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: { status: "approved" },
          };
        },
      },
      stores: {
        gateLog: { append: async () => undefined },
        checkpoints: { save: async () => undefined },
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.missing_capabilities).toContain("wait_agent");
    expect(result.missing_capabilities).toContain("subagent_artifact_collection");
  });

  it("manual fallback never counts as a valid pipeline", () => {
    const artifact = createBlockedPipelineArtifact({
      reason: "blocked-no-agent-runtime",
      missing_capabilities: ["spawn_agent", "wait_agent"],
    });

    expect(artifact.pipeline_valid).toBe(false);
    expect(artifact.manual_fallback.kind).toBe("manual_fallback_not_pipeline");
    expect(artifact.manual_fallback.notice).toBe(MANUAL_FALLBACK_NOTICE);
    expect(artifact.manual_fallback_counts_as_pipeline).toBe(false);
    expect(validatePipelineArtifact(artifact).pipeline_valid).toBe(false);
  });

  it("blocks when any mandatory gate is missing", () => {
    const artifact = createPassingPipelineArtifact({
      gates: REQUIRED_PIPELINE_GATES
        .filter((gate) => gate !== "FINAL_VERDICT_GATE")
        .map((gate) => ({
          gate,
          status: "PASS",
          reason: `${gate} passed.`,
          evidence_ref: `gate:${gate}`,
        })),
    });

    const validation = validatePipelineArtifact(artifact);

    expect(validation.status).toBe("BLOCKED");
    expect(validation.missing_gates).toContain("FINAL_VERDICT_GATE");
  });

  it("does not create a valid PASS artifact when required gates are missing", () => {
    const artifact = createPassingPipelineArtifact({
      gates: REQUIRED_PIPELINE_GATES
        .filter((gate) => gate !== "CAPABILITY_GATE")
        .map((gate) => ({
          gate,
          status: "PASS",
          reason: `${gate} passed.`,
          evidence_ref: `gate:${gate}`,
        })),
    });

    expect(artifact.status).toBe("BLOCKED");
    expect(artifact.pipeline_valid).toBe(false);
    expect(artifact.final_verdict.status).toBe("BLOCKED");
  });

  it("blocks when any mandatory hook checkpoint is missing", () => {
    const artifact = createPassingPipelineArtifact({
      hooks: REQUIRED_PIPELINE_HOOKS
        .filter((hook) => hook !== "final_verdict:after")
        .map((checkpoint) => ({
          checkpoint,
          status: "PASS",
          reason: `${checkpoint} recorded.`,
          evidence_ref: `checkpoint:${checkpoint}`,
        })),
    });

    const validation = validatePipelineArtifact(artifact);

    expect(validation.status).toBe("BLOCKED");
    expect(validation.missing_hooks).toContain("final_verdict:after");
  });

  it("blocks adversarial review without independent primary and adversarial reviewers", () => {
    const artifact = createPassingPipelineArtifact({
      agents: [
        {
          role: "primary_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:primary",
          independent: true,
        },
      ],
    });

    const validation = validatePipelineArtifact(artifact, { adversarial: true });

    expect(validation.status).toBe("BLOCKED");
    expect(validation.missing_agents).toContain("adversarial_reviewer");
  });

  it("blocks security review without a security reviewer", () => {
    const artifact = createPassingPipelineArtifact();
    const validation = validatePipelineArtifact(artifact, { adversarial: true, security: true });

    expect(validation.status).toBe("BLOCKED");
    expect(validation.missing_agents).toContain("security_reviewer");
  });

  it("passes only when capabilities, gates, hooks, agents, and verdict are complete", () => {
    const capabilityGate = evaluateCapabilities(completeRuntime());
    const artifact = createPassingPipelineArtifact({
      gates: REQUIRED_PIPELINE_GATES.map((gate) => ({
        gate,
        status: "PASS",
        reason: gate === "CAPABILITY_GATE" ? capabilityGate.gate.reason : `${gate} passed.`,
        evidence_ref: gate === "CAPABILITY_GATE" ? capabilityGate.gate.evidence_ref : `gate:${gate}`,
      })),
      agents: [
        {
          role: "primary_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:primary",
          independent: true,
        },
        {
          role: "adversarial_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:adversarial",
          independent: true,
        },
        {
          role: "security_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:security",
          independent: true,
        },
      ],
    });

    expect(capabilityGate.status).toBe("PASS");
    expect(validatePipelineArtifact(artifact, { adversarial: true, security: true })).toMatchObject({
      status: "PASS",
      pipeline_valid: true,
    });
  });
});
