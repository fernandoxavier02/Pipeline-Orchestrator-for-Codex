import { describe, expect, it } from "vitest";
import { resolveCliExitCode, runPipelineCli } from "../../../src/cli/pipeline-cli.js";

describe("pipeline CLI exit code", () => {
  it("treats every blocked status as a failed execution", () => {
    expect(resolveCliExitCode({ status: "blocked" })).toBe(1);
    expect(resolveCliExitCode({ status: "BLOCKED" })).toBe(1);
    expect(resolveCliExitCode({ status: "blocked-no-agent-runtime" })).toBe(1);
    expect(resolveCliExitCode({ status: "blocked-awaiting-parent-action" })).toBe(1);
  });

  it("keeps successful non-blocked results at exit code zero", () => {
    expect(resolveCliExitCode({ status: "phase-1" })).toBe(0);
    expect(resolveCliExitCode({ ok: true })).toBe(0);
  });

  it("blocks strict CLI execution before pretending a missing adapter can spawn agents", async () => {
    const result = await runPipelineCli({
      cwd: process.cwd(),
      codexHome: process.cwd(),
      strictAgents: true,
      task: "audit current workflow execution",
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      pipeline_valid: false,
      blockedBy: "CAPABILITY_GATE",
    });
    expect(result.missing_capabilities).toContain("spawn_agent");
    expect(resolveCliExitCode(result)).toBe(1);
  });

  it("blocks an injected adapter that cannot wait for agents or collect artifacts", async () => {
    const result = await runPipelineCli({
      cwd: process.cwd(),
      codexHome: process.cwd(),
      strictAgents: true,
      task: "audit current workflow execution",
      agentRuntime: {
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              status: "approved",
              dispatchMode: "real-agent",
            },
          };
        },
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.missing_capabilities).toContain("wait_agent");
    expect(result.pipeline_valid).toBe(false);
  });

  it("uses the operational runtime when a complete agent adapter is explicitly injected", async () => {
    const result = await runPipelineCli({
      cwd: process.cwd(),
      codexHome: process.cwd(),
      strictAgents: true,
      task: "audit current workflow execution",
      agentRuntime: {
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              status: "approved",
              dispatchMode: "real-agent",
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    expect(result.status).not.toBe("BLOCKED");
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });
});
