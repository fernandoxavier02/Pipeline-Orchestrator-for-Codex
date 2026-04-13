import { classifyGateHardness } from "./hardness-policy.js";
export function runInformationGate(input) {
    const hotfixLike = input.mode === "--hotfix";
    const referenceQuestions = hotfixLike ? [] : input.referenceIndex?.getGateQuestions("macro") ?? [];
    const scopedQuestions = input.classification.type === "Audit"
        ? ["Which systems, assets, or trust boundaries are in scope for this audit?"]
        : input.classification.type === "UX Simulation"
            ? ["Which journey, decision point, or accessibility path are we simulating first?"]
            : [];
    const needsReproduction = input.classification.type === "Bug Fix" && input.knownFacts.length === 0;
    if (needsReproduction) {
        return {
            gate: "INFO_GATE_BLOCKED",
            status: "blocked",
            hardness: classifyGateHardness({ blocker: true, severity: "high" }),
            reason: "Missing reproduction steps",
            questions: hotfixLike
                ? ["What blocker is this hotfix addressing right now?"]
                : ["What are the reproduction steps for this bug?", ...referenceQuestions],
        };
    }
    return {
        gate: "INFO_GATE_OK",
        status: "passed",
        hardness: "SOFT",
        reason: "Enough information to continue",
        questions: [...scopedQuestions, ...referenceQuestions],
    };
}
