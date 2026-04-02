export function runDesignInterrogation(input) {
    const triggered = input.mode === "--grill" || input.complexity === "COMPLEXA";
    if (!triggered) {
        return {
            kind: "DESIGN_INTERROGATION",
            status: "skipped",
            summary: "Design interrogation not required for this request.",
            questions: [],
        };
    }
    return {
        kind: "DESIGN_INTERROGATION",
        status: "partial",
        summary: `Design interrogation requested for: ${input.request}`,
        questions: ["What design trade-off should we prefer here?"],
    };
}
