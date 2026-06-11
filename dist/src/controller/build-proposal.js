import { createChangeContract, createPlanModeRequest, getPlanModeBypass, renderPlanModeRequestBlock, } from "./plan-mode.js";
import { buildWorkflowSelection } from "./workflow-selection.js";
function inferAffectedFiles(variant) {
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
export function buildProposal(input) {
    const affectedFiles = input.affectedFiles?.length ? input.affectedFiles : inferAffectedFiles(input.classification.variant);
    const planModeRequest = input.planModeStatus === "required"
        ? createPlanModeRequest({
            request: input.request,
            variant: input.classification.variant,
            affectedFiles,
        })
        : undefined;
    return {
        summary: input.request,
        variant: input.classification.variant,
        awaitingUserConfirmation: true,
        infoGateStatus: input.infoGateStatus,
        designReviewStatus: input.designReviewStatus,
        planModeStatus: input.planModeStatus,
        affectedFiles,
        batchSize: input.batchSize,
        validationIntent: input.validationIntent,
        planModeBypass: input.mode
            ? getPlanModeBypass(input.mode, input.classification.complexity)
            : undefined,
        CHANGE_CONTRACT: createChangeContract({
            affectedFiles,
            batchSize: input.batchSize,
        }),
        workflowSelection: buildWorkflowSelection({
            request: input.request,
            classification: input.classification,
            profileSummary: input.profileSummary,
        }),
        planModeRequest,
        planModeRequestBlock: planModeRequest ? renderPlanModeRequestBlock(planModeRequest) : undefined,
    };
}
