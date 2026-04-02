export function createCheckpointValidator() {
    let consecutiveFailures = 0;
    return {
        reset() {
            consecutiveFailures = 0;
        },
        validateCheckpoints(input) {
            const requiredCheckpoints = Math.max(1, input.verificationEvidence?.requiredCheckpoints ?? 1);
            const verifiedCheckpoints = input.verificationEvidence?.verifiedCheckpoints ?? 0;
            const evidence = input.verificationEvidence?.evidence ?? [];
            const coverage = verifiedCheckpoints / requiredCheckpoints;
            const passed = evidence.length > 0 && coverage >= 2 / 3;
            if (passed) {
                consecutiveFailures = 0;
            }
            else {
                consecutiveFailures += 1;
            }
            return {
                status: passed ? "passed" : consecutiveFailures >= 2 ? "STOP_RULE" : "failed",
                consecutiveFailures,
                requiredCheckpoints,
                verifiedCheckpoints,
                coverage,
                checkpointName: input.checkpointName,
            };
        },
    };
}
