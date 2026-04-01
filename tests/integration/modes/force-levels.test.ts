import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { parseMode } from "../../../src/controller/parse-mode.js";

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

describe("force level modes", () => {
  it.each([
    ["/pipeline --simples audit auth flow", "--simples", "audit auth flow"],
    ["/pipeline --media audit auth flow", "--media", "audit auth flow"],
    ["/pipeline --complexa audit auth flow", "--complexa", "audit auth flow"],
    ["/pipeline --plan audit auth flow", "--plan", "audit auth flow"],
    ["/pipeline --grill audit auth flow", "--grill", "audit auth flow"],
    ["/pipeline --hotfix audit auth flow", "--hotfix", "audit auth flow"],
  ])("parses %s", (input, mode, normalizedRequest) => {
    expect(parseMode(input)).toEqual({
      mode,
      normalizedRequest,
    });
  });

  it("lets --media override the heuristic complexity", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --media feature onboarding flow");

    expect(result.mode).toBe("--media");
    expect(result.type).toBe("Feature");
    expect(result.complexity).toBe("MEDIA");
    expect(result.variant).toBe("implement-light");
  });

  it("lets --simples override the heuristic complexity", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --simples audit auth flow");

    expect(result.mode).toBe("--simples");
    expect(result.type).toBe("Audit");
    expect(result.complexity).toBe("SIMPLES");
  });

  it("lets --complexa override the heuristic complexity", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --complexa feature onboarding flow");

    expect(result.mode).toBe("--complexa");
    expect(result.type).toBe("Feature");
    expect(result.complexity).toBe("COMPLEXA");
    expect(result.variant).toBe("implement-heavy");
  });

  it("turns on design interrogation for --grill", async () => {
    const controller = createTestController();

    const result = await controller.start("/pipeline --grill feature onboarding flow");

    expect(result.mode).toBe("--grill");
    expect(result.proposal.designReviewStatus).toBe("partial");
  });
});
