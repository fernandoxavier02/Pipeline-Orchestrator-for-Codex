import type { PipelineMode } from "../domain/pipeline-types.js";
import type { PipelineComplexity } from "./classification-overrides.js";
import type { ProposalConfirmationStatus } from "./confirm-proposal.js";

export type PlanModeStatus = "required" | "optional" | "skipped";

export interface ImplementationPlan {
  kind: "IMPLEMENTATION_PLAN";
  status: ProposalConfirmationStatus;
  summary: string;
  affectedFiles: string[];
}

export function getPlanModeStatus(mode: PipelineMode, complexity: PipelineComplexity): PlanModeStatus {
  if (mode === "--plan") {
    return "required";
  }

  if (complexity === "COMPLEXA") {
    return "required";
  }

  return "skipped";
}

export function createImplementationPlan(input: {
  status: ProposalConfirmationStatus;
  summary?: string;
  affectedFiles?: string[];
}): ImplementationPlan {
  return {
    kind: "IMPLEMENTATION_PLAN",
    status: input.status,
    summary: input.summary ?? "Implementation plan ready for approval.",
    affectedFiles: input.affectedFiles ?? [],
  };
}
