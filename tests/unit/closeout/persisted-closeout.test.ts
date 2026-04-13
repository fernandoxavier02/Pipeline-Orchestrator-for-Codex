import { describe, expect, it } from "vitest";

import { buildPersistedCloseout } from "../../../src/closeout/persisted-closeout.js";

describe("persisted closeout", () => {
  it("builds the authoritative closeout package used by finalize", () => {
    const result = buildPersistedCloseout({
      validation: {
        decision: "NO-GO",
        confidenceScore: 0.83,
        confidenceBand: "medium",
        missingEvidence: ["final-review"],
        blockingGates: ["CHECKPOINT_FAIL"],
        skippedSoftGates: ["CLOSEOUT_CONFIRM"],
        blockedReviews: 1,
        rollbackHint: "revalidate",
      },
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: false, label: "final adversarial review" },
      ],
      batches: [{ name: "batch-1" }],
      validationIntent: "standard",
      updatedAt: "2026-04-12T12:00:00.000Z",
    });

    expect(result).toEqual({
      closeout: {
        decision: "NO-GO",
        confidenceScore: 0.83,
        confidenceBand: "medium",
        missingEvidence: ["final-review"],
        blockingGates: ["CHECKPOINT_FAIL"],
        skippedSoftGates: ["CLOSEOUT_CONFIRM"],
        blockedReviews: 1,
        rollbackHint: "revalidate",
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
          { kind: "final-review", passed: false, label: "final adversarial review" },
        ],
        updatedAt: "2026-04-12T12:00:00.000Z",
      },
      renderInput: {
        closeout: {
          decision: "NO-GO",
          confidenceScore: 0.83,
          confidenceBand: "medium",
          missingEvidence: ["final-review"],
          blockingGates: ["CHECKPOINT_FAIL"],
          skippedSoftGates: ["CLOSEOUT_CONFIRM"],
          blockedReviews: 1,
          rollbackHint: "revalidate",
          verificationEvidence: [
            { kind: "build", passed: true, label: "npm run build" },
            { kind: "tests", passed: true, label: "npm test" },
            { kind: "final-review", passed: false, label: "final adversarial review" },
          ],
          updatedAt: "2026-04-12T12:00:00.000Z",
        },
        batches: [{ name: "batch-1" }],
        validationIntent: "standard",
      },
    });
  });
});
