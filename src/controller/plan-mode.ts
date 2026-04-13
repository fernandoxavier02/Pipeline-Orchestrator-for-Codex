import type { PipelineMode } from "../domain/pipeline-types.js";
import type { PipelineComplexity } from "./classification-overrides.js";
import type { ProposalConfirmationStatus } from "./confirm-proposal.js";

export type PlanModeStatus = "required" | "optional" | "skipped";

export interface ImplementationPlan {
  kind: "IMPLEMENTATION_PLAN";
  status: ProposalConfirmationStatus;
  summary: string;
  affectedFiles: string[];
  tasks: string[];
  risks: string[];
  approvalNotes: string;
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
  variant?: string;
  validationIntent?: "standard" | "reduced";
}): ImplementationPlan {
  const variant = input.variant ?? "implement-light";

  return {
    kind: "IMPLEMENTATION_PLAN",
    status: input.status,
    summary: input.summary ?? "Implementation plan ready for approval.",
    affectedFiles: input.affectedFiles ?? [],
    tasks: [
      "Confirm the failing or review-driving scenarios before implementation.",
      "Implement the scoped change in the affected files.",
      "Run verification and capture approval evidence for the batch.",
    ],
    risks: [
      variant.startsWith("audit-") || variant.startsWith("adversarial-")
        ? "State transitions or persistence can drift from the intended pipeline behavior."
        : "Implementation scope can drift if the affected files expand without updating the batch plan.",
      "Review evidence can become stale if the touched files expand during execution.",
      input.validationIntent === "reduced"
        ? "Reduced validation lowers ceremony and needs an explicit blocker justification."
        : "Verification gaps can invalidate the plan if the expected regression surface is not exercised.",
    ],
    approvalNotes:
      input.status === "APPROVED"
        ? "Controller-approved plan is ready for execution once RED proof exists."
        : input.status === "ADJUSTED"
          ? "Plan needs adjustment before execution can proceed."
          : "Plan was rejected and must not proceed to execution.",
  };
}
