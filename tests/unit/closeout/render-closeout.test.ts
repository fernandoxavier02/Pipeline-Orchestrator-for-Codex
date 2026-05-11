import { describe, expect, it } from "vitest";
import { renderCloseout } from "../../../src/closeout/render-closeout.js";

describe("render closeout", () => {
  it("renders from the persisted authoritative closeout result shape", () => {
    const text = renderCloseout({
      closeout: {
        decision: "CONDITIONAL",
        confidenceBand: "medium",
        confidenceScore: 0.71,
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
          { kind: "final-review", passed: false, label: "final adversarial review" },
        ],
        missingEvidence: ["final-review"],
        skippedSoftGates: ["CLOSEOUT_CONFIRM"],
        blockingGates: [],
        blockedReviews: 0,
        rollbackHint: "revalidate",
        updatedAt: "2026-04-12T12:00:00.000Z",
      },
      batches: [{ name: "batch-1" }],
      validationIntent: "standard",
    });

    expect(text).toContain("Final decision: CONDITIONAL");
    expect(text).toContain("Confidence: medium (0.71)");
    expect(text).toContain("Verification evidence: npm run build, npm test");
    expect(text).toContain("Missing evidence: final-review");
    expect(text).toContain("Skipped SOFT gates: CLOSEOUT_CONFIRM");
    expect(text).toContain("Rollback hint: revalidate");
    expect(text).toContain("NEXT_STEP:");
    expect(text).toContain("current_workflow: pipeline");
    expect(text).toContain("next_workflow: verify-completion");
  });
});
