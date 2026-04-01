import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";

function createTestController() {
  return createPipelineController({
    stores: {
      session: {
        load: async () => ({ currentPhase: "phase-0" }),
      },
      checkpoints: {
        list: async () => [],
      },
    },
  });
}

describe("phase 1.5 planning trigger", () => {
  it("marks COMPLEXA requests as requiring plan mode", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --complexa harden audit trail");

    expect(result.mode).toBe("--complexa");
    expect(result.proposal.planModeStatus).toBe("required");
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it("marks explicit --plan requests as planning candidates", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --plan improve onboarding flow");

    expect(result.mode).toBe("--plan");
    expect(result.proposal.planModeStatus).toBe("required");
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });
});
