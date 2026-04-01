import type { GateResult } from "./gate-types.js";

export function runMicroGate(input: {
  hasTests: boolean;
  hasUnresolvedFindings: boolean;
}): GateResult {
  if (!input.hasTests) {
    return {
      gate: "TDD_APPROVAL",
      status: "blocked",
      hardness: "HARD",
      reason: "Batch has no test evidence",
      questions: ["Which failing test proves the batch requirement?"],
    };
  }

  return {
    gate: "MICRO_GATE_OK",
    status: input.hasUnresolvedFindings ? "partial" : "passed",
    hardness: input.hasUnresolvedFindings ? "HARD" : "SOFT",
    reason: input.hasUnresolvedFindings ? "Findings remain open" : "Batch can proceed",
    questions: [],
  };
}
