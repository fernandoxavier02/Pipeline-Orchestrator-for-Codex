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
    return {
        kind: "IMPLEMENTATION_PLAN",
        status: input.status,
        summary: input.summary ?? "Implementation plan ready for approval.",
        affectedFiles: input.affectedFiles ?? [],
    };
}
