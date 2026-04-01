import type { GateResult } from "./gate-types.js";
import type { ReferenceProfileIndex } from "../references/reference-profiles.js";

export function runMicroGate(input: {
  hasTests: boolean;
  hasUnresolvedFindings: boolean;
  touchedPaths?: string[];
  referenceIndex?: ReferenceProfileIndex;
}): GateResult {
  const checklistIds = input.referenceIndex?.selectChecklistIdsForTouchedPaths(input.touchedPaths ?? []);
  const referenceQuestions = input.referenceIndex?.getGateQuestions("micro") ?? [];

  if (!input.hasTests) {
    return {
      gate: "TDD_APPROVAL",
      status: "blocked",
      hardness: "HARD",
      reason: "Batch has no test evidence",
      questions: ["Which failing test proves the batch requirement?", ...referenceQuestions],
      checklistIds,
    };
  }

  return {
    gate: "MICRO_GATE_OK",
    status: input.hasUnresolvedFindings ? "partial" : "passed",
    hardness: input.hasUnresolvedFindings ? "HARD" : "SOFT",
    reason: input.hasUnresolvedFindings ? "Findings remain open" : "Batch can proceed",
    questions: referenceQuestions,
    checklistIds,
  };
}
