export interface CheckpointValidationResult {
  status: "passed" | "failed" | "STOP_RULE";
  consecutiveFailures: number;
  requiredCheckpoints: number;
  verifiedCheckpoints: number;
  coverage: number;
  checkpointName: string;
}

export interface CheckpointValidationEvidence {
  requiredCheckpoints: number;
  verifiedCheckpoints: number;
  evidence: string[];
}

export function evaluateCheckpointValidation(input: {
  verificationEvidence?: CheckpointValidationEvidence;
  checkpointName: string;
  previousFailures?: number;
}): CheckpointValidationResult {
  const requiredCheckpoints = Math.max(1, input.verificationEvidence?.requiredCheckpoints ?? 1);
  const verifiedCheckpoints = input.verificationEvidence?.verifiedCheckpoints ?? 0;
  const evidence = input.verificationEvidence?.evidence ?? [];
  const coverage = verifiedCheckpoints / requiredCheckpoints;
  const passed = evidence.length > 0 && coverage >= 2 / 3;
  const consecutiveFailures = passed ? 0 : (input.previousFailures ?? 0) + 1;

  return {
    status: passed ? "passed" : consecutiveFailures >= 2 ? "STOP_RULE" : "failed",
    consecutiveFailures,
    requiredCheckpoints,
    verifiedCheckpoints,
    coverage,
    checkpointName: input.checkpointName,
  };
}

export function createCheckpointValidator() {
  let consecutiveFailures = 0;

  return {
    reset() {
      consecutiveFailures = 0;
    },
    validateCheckpoints(input: {
      verificationEvidence?: {
        requiredCheckpoints: number;
        verifiedCheckpoints: number;
        evidence: string[];
      };
      checkpointName: string;
    }): CheckpointValidationResult {
      const result = evaluateCheckpointValidation({
        verificationEvidence: input.verificationEvidence,
        checkpointName: input.checkpointName,
        previousFailures: consecutiveFailures,
      });
      consecutiveFailures = result.consecutiveFailures;
      return result;
    },
  };
}
