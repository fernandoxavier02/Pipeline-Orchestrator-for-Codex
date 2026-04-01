import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createPipelineRuntime } from "../../../src/index.js";

describe("pipeline controller", () => {
  const runtime = createPipelineRuntime({
    cwd: process.cwd(),
    codexHome: "/codex-home",
  });

  it("parses diagnostic mode from command-like input", async () => {
    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");
    expect(result.mode).toBe("diagnostic");
    expect(result.type).toBe("Audit");
  });

  it("builds a visible proposal before execution", async () => {
    const result = await runtime.controller.start("fix login redirect loop");
    expect(result.proposal.summary).toContain("fix login redirect loop");
    expect(result.proposal.variant).toMatch(/bugfix/);
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it("does not resolve the reference bundle when resuming", async () => {
    let referenceIndexCalls = 0;
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({ currentPhase: "phase-2" }),
        },
        checkpoints: {
          list: async () => [{ name: "plan", status: "completed" }],
        },
      },
      referenceIndex: async () => {
        referenceIndexCalls += 1;
        throw new Error("reference bundle should not be loaded for continue mode");
      },
    });

    const result = await controller.start("/pipeline continue");

    expect(result).toEqual({
      resumeFrom: "plan",
      nextPhase: "phase-2",
    });
    expect(referenceIndexCalls).toBe(0);
  });
});
