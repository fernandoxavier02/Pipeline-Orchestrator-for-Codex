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
