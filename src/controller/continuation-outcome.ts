type ExecutionResultPayload = {
  status?: unknown;
  blockedBy?: unknown;
};

export function deriveContinuationOutcome(input: { executionResult: unknown }) {
  const payload = input.executionResult && typeof input.executionResult === "object"
    ? input.executionResult as ExecutionResultPayload
    : {};
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const blockedBy = typeof payload.blockedBy === "string" ? payload.blockedBy : undefined;
  const isCircuitBreaker = status === "STOP_RULE" || status === "FIX_LOOP_EXHAUSTED";
  const isMalformed = !status;
  const isBlocked = status === "blocked";
  const isKnownRework = blockedBy === "FINAL_ADVERSARIAL_REWORK";
  const blocker =
    isKnownRework
      ? blockedBy
      : isCircuitBreaker
        ? status
        : isBlocked && blockedBy
          ? blockedBy
          : "CHECKPOINT_FAIL";
  const circuitBreaker = isCircuitBreaker;
  const checkpointFailure = status === "failed" || isMalformed || (isBlocked && !blockedBy);

  return {
    blocker,
    nextPhase: blocker === "FINAL_ADVERSARIAL_REWORK"
      ? "phase-2"
      : isBlocked
        ? "phase-1.5"
        : "phase-2",
    pendingDecision: blocker === "FINAL_ADVERSARIAL_REWORK"
      ? "replan"
      : circuitBreaker
        ? "stop"
        : checkpointFailure || isBlocked
          ? "revalidate"
          : undefined,
    checkpointFailure,
    circuitBreaker,
  };
}
