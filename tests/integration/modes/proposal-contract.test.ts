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

describe("proposal contract", () => {
  it("includes the SSOT proposal fields for a complex request", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --complexa audit security boundary review");

    expect(result.proposal).toMatchObject({
      summary: "audit security boundary review",
      variant: "audit-heavy",
      infoGateStatus: "passed",
      designReviewStatus: "partial",
      planModeStatus: "required",
      batchSize: 1,
    });
    expect(Array.isArray(result.proposal.affectedFiles)).toBe(true);
    expect(result.proposal.affectedFiles.length).toBeGreaterThan(0);
  });
});
