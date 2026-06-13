import { describe, expect, it } from "vitest";

import { runFinalValidator } from "../../../src/validation/final-validator.js";

describe("final validator gate-log decisions", () => {
  it("returns GO with approved reviews, strong confidence, and full verification evidence", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.92,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(result.decision).toBe("GO");
    expect(result.confidenceBand).toBe("high");
    expect(result.requiredEvidence).toEqual(["build", "tests", "final-review"]);
    expect(result.missingEvidence).toEqual([]);
    expect(result.skippedSoftGates).toEqual([]);
  });

  it("returns CONDITIONAL when only SOFT gates are skipped and confidence falls into the medium band", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.71,
      gateLog: [
        {
          gate: "FINAL_ADVERSARIAL_GATE",
          hardness: "SOFT",
          phase: "phase-3",
          decision: "skip",
          decided_by: "user",
          timestamp: "2026-04-02T12:00:00.000Z",
          detail: "Operator skipped optional final adversarial gate",
          confidence_impact: -0.15,
        },
      ],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(result.decision).toBe("CONDITIONAL");
    expect(result.confidenceBand).toBe("medium");
    expect(result.skippedSoftGates).toEqual(["FINAL_ADVERSARIAL_GATE"]);
    expect(result.blockingGates).toEqual([]);
  });

  it("returns NO-GO when a blocking gate is present and exposes the rollback hint", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.88,
      gateLog: [
        {
          gate: "CHECKPOINT_FAIL",
          hardness: "HARD",
          phase: "phase-2",
          decision: "block",
          decided_by: "controller",
          timestamp: "2026-04-02T12:00:00.000Z",
          detail: "Checkpoint validation failed after execution",
          confidence_impact: 0,
        },
      ],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.blockingGates).toEqual(["CHECKPOINT_FAIL"]);
    expect(result.rollbackHint).toBe("revalidate");
  });

  it("clears a recoverable revalidation gate when a later controller-authoritative pass resolves it", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: [
        {
          gate: "CHECKPOINT_FAIL",
          hardness: "HARD",
          phase: "phase-2",
          decision: "block",
          decided_by: "controller",
          timestamp: "2026-04-02T12:00:00.000Z",
          detail: "Checkpoint failed",
          confidence_impact: 0,
        },
        {
          gate: "CHECKPOINT_FAIL",
          hardness: "HARD",
          phase: "phase-2",
          decision: "pass",
          decided_by: "controller",
          timestamp: "2026-04-02T12:05:00.000Z",
          detail: "Controller revalidated the checkpoint successfully",
          confidence_impact: 0,
        },
      ],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(result.decision).toBe("GO");
    expect(result.blockingGates).toEqual([]);
  });

  it("keeps a terminal stop gate sticky even when a later duplicate entry says pass", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: [
        {
          gate: "STOP_RULE",
          hardness: "CIRCUIT_BREAKER",
          phase: "phase-2",
          decision: "block",
          decided_by: "controller",
          timestamp: "2026-04-02T12:00:00.000Z",
          detail: "Execution hit the stop rule",
          confidence_impact: 0,
        },
        {
          gate: "STOP_RULE",
          hardness: "CIRCUIT_BREAKER",
          phase: "phase-2",
          decision: "pass",
          decided_by: "controller",
          timestamp: "2026-04-02T12:05:00.000Z",
          detail: "A later duplicate pass must not erase the stop gate",
          confidence_impact: 0,
        },
      ],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.blockingGates).toEqual(["STOP_RULE"]);
  });

  it("does not let AUDIT gates block closeout even when they record a block decision", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.92,
      gateLog: [
        {
          gate: "BOOTSTRAP_EXEMPTION_USED",
          hardness: "AUDIT",
          phase: "phase-1",
          decision: "block",
          decided_by: "controller",
          timestamp: "2026-04-02T12:00:00.000Z",
          detail: "Audit-only governance event",
          confidence_impact: 0,
        },
      ],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
      mode: "review-only",
    });

    expect(result.decision).toBe("GO");
    expect(result.blockingGates).toEqual([]);
  });
});
