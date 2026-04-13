export function renderCloseout(input: {
  closeout: {
    decision: "GO" | "CONDITIONAL" | "NO-GO";
    confidenceBand: "low" | "medium" | "high";
    confidenceScore: number;
    verificationEvidence: Array<{ label?: string; kind: string; passed: boolean }>;
    blockingGates: string[];
    skippedSoftGates: string[];
    blockedReviews: number;
    missingEvidence: string[];
    rollbackHint?: string | null;
    updatedAt: string;
  };
  batches: Array<{ name: string }>;
  validationIntent?: string;
}) {
  const passedEvidence = input.closeout.verificationEvidence
    .filter((evidence) => evidence.passed)
    .map((evidence) => evidence.label ?? evidence.kind);
  const lines = [
    `Final decision: ${input.closeout.decision}`,
    `Confidence: ${input.closeout.confidenceBand} (${input.closeout.confidenceScore.toFixed(2)})`,
    `Validation profile: ${input.validationIntent === "reduced" ? "reduced" : "standard"}`,
    `Verification evidence: ${passedEvidence.join(", ") || "none recorded"}`,
    `Batches executed: ${input.batches.map((batch) => batch.name).join(", ") || "none"}`,
  ];

  if (input.closeout.missingEvidence.length > 0) {
    lines.push(`Missing evidence: ${input.closeout.missingEvidence.join(", ")}`);
  }

  if (input.closeout.skippedSoftGates.length > 0) {
    lines.push(`Skipped SOFT gates: ${input.closeout.skippedSoftGates.join(", ")}`);
  }

  if (input.closeout.rollbackHint) {
    lines.push(`Rollback hint: ${input.closeout.rollbackHint}`);
  }

  return lines.join("\n");
}
