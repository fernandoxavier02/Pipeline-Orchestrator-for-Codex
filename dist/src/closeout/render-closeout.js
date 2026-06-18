import { renderNextStepBlock, resolveNextStep } from "../workflow/next-step.js";
export function renderCloseout(input) {
    const passedEvidence = input.closeout.verificationEvidence
        .filter((evidence) => evidence.passed)
        .map((evidence) => evidence.label ?? evidence.kind);
    const lines = [
        `Closeout decision: ${input.closeout.decision}`,
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
    lines.push(renderNextStepBlock(resolveNextStep({
        workflow: "pipeline",
        status: input.closeout.decision === "NO-GO" ? "blocked" : "passed",
    })));
    return lines.join("\n");
}
