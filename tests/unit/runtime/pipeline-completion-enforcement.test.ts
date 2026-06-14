import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";

describe("runtime pipeline completion enforcement", () => {
  it("RED: blocks PIPELINE COMPLETE without protocol and gate evidence", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-enforcement-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
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
              text: "PIPELINE COMPLETE",
              status: "approved",
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

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline fix completion evidence",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      blockedReason: expect.stringContaining("protocol-events"),
      pipeline_valid: false,
      manual_fallback_counts_as_pipeline: false,
    });
  });
});
