export function renderCloseout(input) {
    const passedEvidence = input.verificationEvidence
        .filter((evidence) => evidence.passed)
        .map((evidence) => evidence.label ?? evidence.kind);
    const lines = [
        `Final decision: ${input.decision}`,
        `Confidence: ${input.confidenceBand} (${input.confidenceScore.toFixed(2)})`,
        `Validation profile: ${input.validationIntent === "reduced" ? "reduced" : "standard"}`,
        `Verification evidence: ${passedEvidence.join(", ") || "none recorded"}`,
        `Batches executed: ${input.batches.map((batch) => batch.name).join(", ") || "none"}`,
    ];
    if (input.missingEvidence.length > 0) {
        lines.push(`Missing evidence: ${input.missingEvidence.join(", ")}`);
    }
    if (input.skippedSoftGates.length > 0) {
        lines.push(`Skipped SOFT gates: ${input.skippedSoftGates.join(", ")}`);
    }
    if (input.rollbackHint) {
        lines.push(`Rollback hint: ${input.rollbackHint}`);
    }
    return lines.join("\n");
}
