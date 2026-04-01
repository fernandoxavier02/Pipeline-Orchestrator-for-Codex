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

describe("hotfix mode", () => {
  it("forces a reduced-validation bug fix path", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --hotfix patch login session leak");

    expect(result.mode).toBe("--hotfix");
    expect(result.type).toBe("Bug Fix");
    expect(result.complexity).toBe("COMPLEXA");
    expect(result.variant).toBe("bugfix-heavy");
    expect(result.proposal.validationIntent).toBe("reduced");
    expect(result.proposal.batchSize).toBe(1);
  });
});
