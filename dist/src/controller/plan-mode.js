export function getPlanModeStatus(mode, complexity) {
    if (mode === "--plan") {
        return "required";
    }
    if (complexity === "COMPLEXA") {
        return "required";
    }
    return "skipped";
}
export function createImplementationPlan(input) {
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
        approvalNotes: input.status === "APPROVED"
            ? "Controller-approved plan is ready for execution once RED proof exists."
            : input.status === "ADJUSTED"
                ? "Plan needs adjustment before execution can proceed."
                : "Plan was rejected and must not proceed to execution.",
    };
}
