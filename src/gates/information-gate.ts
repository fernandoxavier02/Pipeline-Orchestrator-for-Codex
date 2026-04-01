import { classifyGateHardness } from "./hardness-policy.js";
import type { GateResult } from "./gate-types.js";
import type { ReferenceProfileIndex } from "../references/reference-profiles.js";

export function runInformationGate(input: {
  request: string;
  classification: { type: string; complexity: string };
  knownFacts: string[];
  referenceIndex?: ReferenceProfileIndex;
}): GateResult {
  const referenceQuestions = input.referenceIndex?.getGateQuestions("macro") ?? [];
  const needsReproduction =
    input.classification.type === "Bug Fix" && input.knownFacts.length === 0;

  if (needsReproduction) {
    return {
      gate: "INFO_GATE_BLOCKED",
      status: "blocked",
      hardness: classifyGateHardness({ blocker: true, severity: "high" }),
      reason: "Missing reproduction steps",
      questions: ["What are the reproduction steps for this bug?", ...referenceQuestions],
    };
  }

  return {
    gate: "INFO_GATE_OK",
    status: "passed",
    hardness: "SOFT",
    reason: "Enough information to continue",
    questions: referenceQuestions,
  };
}
