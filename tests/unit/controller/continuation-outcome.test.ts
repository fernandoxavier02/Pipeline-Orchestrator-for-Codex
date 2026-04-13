import { describe, expect, it } from "vitest";
import { deriveContinuationOutcome } from "../../../src/controller/continuation-outcome.js";

describe("continuation outcome", () => {
  it("maps blocked execution and malformed payloads to safe controller outcomes", () => {
    expect(
      deriveContinuationOutcome({
        executionResult: {
          status: "blocked",
        },
      }),
    ).toEqual({
      blocker: "CHECKPOINT_FAIL",
      nextPhase: "phase-1.5",
      pendingDecision: "revalidate",
      checkpointFailure: true,
      circuitBreaker: false,
    });

    expect(
      deriveContinuationOutcome({
        executionResult: {
          status: undefined,
        },
      }),
    ).toEqual({
      blocker: "CHECKPOINT_FAIL",
      nextPhase: "phase-2",
      pendingDecision: "revalidate",
      checkpointFailure: true,
      circuitBreaker: false,
    });
  });

  it("maps failure and circuit-breaker execution results to controller-safe rollbacks", () => {
    expect(
      deriveContinuationOutcome({
        executionResult: {
          status: "failed",
        },
      }),
    ).toEqual({
      blocker: "CHECKPOINT_FAIL",
      nextPhase: "phase-2",
      pendingDecision: "revalidate",
      checkpointFailure: true,
      circuitBreaker: false,
    });

    expect(
      deriveContinuationOutcome({
        executionResult: {
          status: "STOP_RULE",
        },
      }),
    ).toEqual({
      blocker: "STOP_RULE",
      nextPhase: "phase-2",
      pendingDecision: "stop",
      checkpointFailure: false,
      circuitBreaker: true,
    });

    expect(
      deriveContinuationOutcome({
        executionResult: {
          status: "FIX_LOOP_EXHAUSTED",
        },
      }),
    ).toEqual({
      blocker: "FIX_LOOP_EXHAUSTED",
      nextPhase: "phase-2",
      pendingDecision: "stop",
      checkpointFailure: false,
      circuitBreaker: true,
    });
  });

  it("maps final adversarial rework to a replan rollback", () => {
    const result = deriveContinuationOutcome({
      executionResult: {
        status: "blocked",
        blockedBy: "FINAL_ADVERSARIAL_REWORK",
      },
    });

    expect(result).toEqual({
      blocker: "FINAL_ADVERSARIAL_REWORK",
      nextPhase: "phase-2",
      pendingDecision: "replan",
      checkpointFailure: false,
      circuitBreaker: false,
    });
  });
});
