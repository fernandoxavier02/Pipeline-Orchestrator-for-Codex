import type { ValidationIntent } from "./classification-overrides.js";
import type { PlanModeStatus } from "./plan-mode.js";

function inferAffectedFiles(variant: string) {
  if (variant.startsWith("bugfix-")) {
    return ["src/controller/pipeline-controller.ts", "src/controller/parse-mode.ts"];
  }

  if (variant.startsWith("audit-")) {
    return ["src/controller/pipeline-controller.ts", "src/gates/information-gate.ts"];
  }

  if (variant.startsWith("user-story-")) {
    return ["src/controller/pipeline-controller.ts", "src/controller/plan-mode.ts"];
  }

  if (variant.startsWith("ux-sim-")) {
    return ["src/controller/pipeline-controller.ts", "src/controller/design-interrogator.ts"];
  }

  return ["src/controller/pipeline-controller.ts", "src/controller/build-proposal.ts"];
}

export function buildProposal(input: {
  request: string;
  classification: { variant: string };
  infoGateStatus: "passed" | "blocked" | "partial";
  designReviewStatus: "passed" | "partial" | "skipped";
  planModeStatus: PlanModeStatus;
  batchSize: number;
  validationIntent: ValidationIntent;
  affectedFiles?: string[];
}) {
  return {
    summary: input.request,
    variant: input.classification.variant,
    awaitingUserConfirmation: true,
    infoGateStatus: input.infoGateStatus,
    designReviewStatus: input.designReviewStatus,
    planModeStatus: input.planModeStatus,
    affectedFiles: input.affectedFiles?.length ? input.affectedFiles : inferAffectedFiles(input.classification.variant),
    batchSize: input.batchSize,
    validationIntent: input.validationIntent,
  };
}
