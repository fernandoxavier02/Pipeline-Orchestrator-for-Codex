export function getPlanModeStatus(mode, complexity) {
    if (mode === "--plan") {
        return "required";
    }
    if (complexity === "COMPLEXA") {
        return "required";
    }
    return "skipped";
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "request";
}
export function createPlanModeRequest(input) {
    return {
        kind: "PLAN_MODE_REQUEST",
        protocol_version: 1,
        source: "pipeline-controller",
        plan_id: `plan-${slugify(input.variant)}-${slugify(input.request)}`,
        research_scope: `Plan the ${input.variant} workflow before execution: ${input.request}`,
        expected_deliverables: [
            "Confirmed workflow and user-approved adjustments",
            "PDD: visible update_plan protocol before editing, dispatching, or claiming completion",
            "DDD: domain boundaries, invariants, and SSOT ownership before implementation choices",
            "ATDD: acceptance criteria or report acceptance checks before execution",
            "TDD: failing test or report-only evidence-first equivalent before change/claim",
            "Batch plan with checkpoint validation and adversarial review after every batch",
            `Affected files: ${input.affectedFiles.length > 0 ? input.affectedFiles.join(", ") : "to be discovered"}`,
        ],
    };
}
export function renderPlanModeRequestBlock(request) {
    const lines = [
        "=== PLAN_MODE_REQUEST v1 ===",
        `kind: ${request.kind}`,
        `protocol_version: ${request.protocol_version}`,
        `source: ${request.source}`,
        `plan_id: ${JSON.stringify(request.plan_id)}`,
        `research_scope: ${JSON.stringify(request.research_scope)}`,
        "expected_deliverables:",
        ...request.expected_deliverables.map((deliverable) => `  - ${JSON.stringify(deliverable)}`),
        "=== END PLAN_MODE_REQUEST ===",
    ];
    return lines.join("\n");
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
