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
    const auditQuestions = [
        "Which user-visible trade-off are we optimizing for first?",
        "What evidence will tell us this design decision worked?",
        "What trust boundary or review surface needs explicit justification before implementation?",
    ];
    const uxQuestions = [
        "Which journey step or accessibility edge case must stay clear after the change?",
        "How will we verify the primary interaction remains understandable under failure or latency?",
    ];
    const defaultQuestions = [
        "Which user-visible trade-off are we optimizing for first?",
        "What evidence will tell us this design decision worked?",
    ];
    const questions = input.type === "Audit"
        ? auditQuestions
        : input.type === "UX Simulation"
            ? uxQuestions
            : defaultQuestions;
    return {
        kind: "DESIGN_INTERROGATION",
        status: "partial",
        summary: `Design interrogation requested for ${input.type ?? "this"} work: ${input.request}`,
        questions,
    };
}
