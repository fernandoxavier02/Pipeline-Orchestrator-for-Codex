import { createGateRegistry } from "../gates/gate-registry.js";
import { resolveFinalValidationEvidence } from "../review/domain-checklists.js";
const LATEST_ONLY_GATES = new Set(["CLOSEOUT_CONFIRM"]);
const STICKY_ROLLBACKS = new Set(["manual", "stop"]);
function getConfidenceBand(score) {
    if (score >= 0.8) {
        return "high";
    }
    if (score >= 0.6) {
        return "medium";
    }
    return "low";
}
export function resolveEffectiveGateLog(entries) {
    const gateRegistry = createGateRegistry();
    const entriesByGate = new Map();
    for (const entry of entries) {
        const history = entriesByGate.get(entry.gate) ?? [];
        history.push(entry);
        entriesByGate.set(entry.gate, history);
    }
    return [...entriesByGate.entries()].map(([, history]) => {
        const gate = history[0]?.gate ?? "";
        if (LATEST_ONLY_GATES.has(gate)) {
            return history.at(-1);
        }
        const rollback = gateRegistry.get(gate).rollback;
        if (STICKY_ROLLBACKS.has(rollback)) {
            const blockingEntry = history.find((entry) => entry.decision === "block");
            if (blockingEntry) {
                return blockingEntry;
            }
        }
        if (rollback === "revalidate" || rollback === "replan") {
            return history.at(-1);
        }
        const blockingEntry = history.find((entry) => entry.decision === "block");
        if (blockingEntry) {
            return blockingEntry;
        }
        return history.at(-1);
    });
}
export function runFinalValidator(input) {
    const gateRegistry = createGateRegistry();
    const effectiveGateLog = resolveEffectiveGateLog(input.gateLog);
    const confidenceBand = getConfidenceBand(input.confidenceScore);
    const blockingGates = effectiveGateLog
        .filter((entry) => entry.decision === "block")
        .map((entry) => entry.gate);
    const skippedSoftGates = effectiveGateLog
        .filter((entry) => entry.hardness === "SOFT" && entry.decision === "skip")
        .map((entry) => entry.gate);
    const requiredEvidence = resolveFinalValidationEvidence({
        mode: input.mode,
        validationIntent: input.validationIntent,
    });
    const passedEvidenceKinds = new Set(input.verificationEvidence
        .filter((evidence) => evidence.passed)
        .map((evidence) => evidence.kind));
    const missingEvidence = requiredEvidence.filter((kind) => !passedEvidenceKinds.has(kind));
    const blockedReviews = input.reviews.filter((review) => review.status !== "approved");
    let decision;
    if (blockingGates.length > 0 || blockedReviews.length > 0 || missingEvidence.length > 0 || input.confidenceScore < 0.6) {
        decision = "NO-GO";
    }
    else if (skippedSoftGates.length > 0 || input.confidenceScore < 0.8) {
        decision = "CONDITIONAL";
    }
    else {
        decision = "GO";
    }
    const rollbackHint = blockingGates
        .map((gate) => gateRegistry.get(gate).rollback)
        .find((rollback) => rollback !== "none");
    return {
        decision,
        confidenceScore: input.confidenceScore,
        confidenceBand,
        requiredEvidence,
        missingEvidence,
        verificationEvidence: input.verificationEvidence,
        blockingGates,
        skippedSoftGates,
        blockedReviews: blockedReviews.length,
        rollbackHint,
    };
}
