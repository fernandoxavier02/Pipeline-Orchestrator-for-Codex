import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";

describe("pipeline execution", () => {
  it("builds batches, runs review, and returns a closeout summary", async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("implement audit-friendly continue mode");

    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it("runs a batch through adversarial review and final validation", async () => {
    const { buildBatches } = await import("../../../src/execution/build-batches.js");
    const { runAdversarialReview } = await import("../../../src/review/adversarial-review.js");
    const { runFinalValidator } = await import("../../../src/validation/final-validator.js");

    const batches = buildBatches({
      files: ["src/controller/pipeline-controller.ts", "src/state/session-store.ts"],
    });
    const review = await runAdversarialReview({
      batch: batches[0],
      findings: [],
    });
    const final = runFinalValidator({
      reviews: [review],
      confidenceScore: 0.91,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(final.decision).toBe("GO");
  });
});
