import { createGateRegistry } from "../gates/gate-registry.js";
import { resolveFinalValidationEvidence } from "../review/domain-checklists.js";
const NON_OPERATIONAL_MODES = new Set(["diagnostic", "review-only"]);
function normalizeMode(mode) {
    if (typeof mode !== "string")
        return undefined;
    const trimmed = mode.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function isNonExemptMode(mode) {
    const normalized = normalizeMode(mode);
    return !!normalized && !NON_OPERATIONAL_MODES.has(normalized);
}
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
    if (isNonExemptMode(input.mode)
        && input.validationIntent !== "reduced") {
        for (const canonicalKind of ["protocol-events", "gate-decisions", "target-latest-trace"]) {
            if (!passedEvidenceKinds.has(canonicalKind)) {
                missingEvidence.push(canonicalKind);
            }
        }
    }
    if (input.dispatchMode
        && input.dispatchMode !== "real-agent"
        && isNonExemptMode(input.mode)) {
        missingEvidence.push("real-agent-dispatch");
    }
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
/**
 * After a final-validator dispatch returns, persist the
 * `post_final_validator` checkpoint so sentinel can confirm the pipeline
 * reached the final gate. Idempotent: callers that have no sentinel store
 * (e.g. unit fixtures) get a no-op.
 */
export async function recordPostFinalValidatorCheckpoint(input) {
    if (!input.sentinelStore?.save) {
        return;
    }
    let prior;
    try {
        prior = (await input.sentinelStore.load?.()) ?? undefined;
    }
    catch {
        prior = undefined;
    }
    const completed = Array.from(new Set([...(prior?.completedPhases ?? []), "phase-2", "phase-3"]));
    await input.sentinelStore.save({
        pipelineActive: input.decision === "NO-GO" ? true : false,
        currentPhase: "phase-3",
        currentAgent: "final-validator",
        expectedNext: [],
        completedPhases: completed,
        gateSummary: [...(prior?.gateSummary ?? []), "SENTINEL_CHECKPOINT"],
        batchState: {
            batchIndex: input.batchIndex ?? prior?.batchState.batchIndex ?? 0,
            status: `post-final-validator:${input.decision.toLowerCase()}`,
        },
        consecutiveCorrections: input.consecutiveCorrections ?? prior?.consecutiveCorrections ?? 0,
        lastCheckpoint: "post_final_validator",
        updatedAt: new Date().toISOString(),
    });
}
export function runSanityChecker(input) {
    const requiredEvidence = resolveFinalValidationEvidence({
        mode: input.mode,
        validationIntent: input.validationIntent,
    });
    const passedEvidenceKinds = new Set(input.verificationEvidence
        .filter((evidence) => evidence.passed)
        .map((evidence) => evidence.kind));
    const missingEvidence = requiredEvidence.filter((kind) => !passedEvidenceKinds.has(kind));
    const evidence = input.verificationEvidence
        .filter((entry) => entry.passed)
        .map((entry) => entry.label ?? entry.kind);
    return {
        status: missingEvidence.length === 0 ? "approved" : "blocked",
        requiredEvidence,
        missingEvidence,
        evidence,
        nextAction: missingEvidence.length === 0 ? "proceed-to-final-validator" : "stop-closeout",
    };
}
