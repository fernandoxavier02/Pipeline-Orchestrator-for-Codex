export function classifyGateHardness(input) {
    if (input.blocker && input.severity === "high") {
        return "MANDATORY";
    }
    if (input.blocker) {
        return "HARD";
    }
    if (input.severity === "high") {
        return "CIRCUIT_BREAKER";
    }
    return "SOFT";
}
