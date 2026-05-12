/**
 * Confidence Model — Deterministic gate-penalty ledger.
 *
 * This is NOT an AI-evaluated quality score. It is a deterministic arithmetic
 * model that tracks how many controller gates passed vs skipped. Each gate
 * decision carries a fixed confidence_impact (from gate-registry.ts); the model
 * simply sums these impacts and clamps the result to [0, 1].
 *
 * The score reflects "how many safety gates were cleared," not "how good the
 * code is." Do not present it as an evidence-based quality metric.
 */
function getBand(score) {
    if (score >= 0.8) {
        return "high";
    }
    if (score >= 0.6) {
        return "medium";
    }
    return "low";
}
export function createConfidenceModel() {
    const thresholds = {
        medium: 0.6,
        high: 0.8,
    };
    return {
        thresholds,
        apply(input) {
            const gate_penalty = input.gates.reduce((total, entry) => total + entry.confidence_impact, 0);
            const score = Math.max(0, Math.min(1, input.baseScore + gate_penalty));
            return {
                score,
                band: getBand(score),
                thresholds,
                gate_penalty,
                dimensions: input.dimensions ?? {},
                updated_at: (input.now ?? new Date()).toISOString(),
            };
        },
    };
}
