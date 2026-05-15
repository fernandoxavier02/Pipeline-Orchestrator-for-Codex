const directWorkflowCommands = {
    "audit-light": { type: "Audit", complexity: "MEDIA", variant: "audit-light" },
    "audit-heavy": { type: "Audit", complexity: "COMPLEXA", variant: "audit-heavy" },
    "bugfix-light": { type: "Bug Fix", complexity: "MEDIA", variant: "bugfix-light" },
    "bugfix-heavy": { type: "Bug Fix", complexity: "COMPLEXA", variant: "bugfix-heavy" },
    "feature-light": { type: "Feature", complexity: "MEDIA", variant: "feature-light" },
    "feature-heavy": { type: "Feature", complexity: "COMPLEXA", variant: "feature-heavy" },
    "spec-light": { type: "Spec", complexity: "MEDIA", variant: "spec-light" },
    "spec-heavy": { type: "Spec", complexity: "COMPLEXA", variant: "spec-heavy" },
    "spec-audit-only": { type: "Spec", complexity: "MEDIA", variant: "spec-audit-only" },
};
const workflowCommandDefaults = {
    audit: { light: "audit-light", heavy: "audit-heavy", defaultVariant: "audit-heavy" },
    bugfix: { light: "bugfix-light", heavy: "bugfix-heavy", defaultVariant: "bugfix-heavy" },
    feature: { light: "feature-light", heavy: "feature-heavy", defaultVariant: "feature-light" },
    spec: { light: "spec-light", heavy: "spec-heavy", defaultVariant: "spec-light" },
};
function consumeLeadingFlag(request) {
    const trimmed = request.trimStart();
    const match = trimmed.match(/^--([a-z-]+)(?:\s+|$)/u);
    if (!match) {
        return { flag: undefined, request: trimmed };
    }
    return {
        flag: match[1],
        request: trimmed.slice(match[0].length).trimStart(),
    };
}
function parseDirectWorkflowCommand(input) {
    const match = input.match(/^\/pipeline-orchestrator-for-codex:([a-z-]+)(?:\s+([\s\S]*))?$/u);
    if (!match) {
        return undefined;
    }
    const command = match[1];
    const rawRequest = match[2] ?? "";
    if (command === "review") {
        return {
            mode: "review-only",
            normalizedRequest: rawRequest.trimStart(),
        };
    }
    const direct = directWorkflowCommands[command];
    if (direct) {
        return {
            mode: "full",
            normalizedRequest: rawRequest.trimStart(),
            explicitClassification: direct,
        };
    }
    const workflowDefault = workflowCommandDefaults[command];
    if (!workflowDefault) {
        return undefined;
    }
    const { flag, request } = consumeLeadingFlag(rawRequest);
    const variant = flag === "light"
        ? workflowDefault.light
        : flag === "heavy"
            ? workflowDefault.heavy
            : flag === "audit-only" && command === "spec"
                ? "spec-audit-only"
                : workflowDefault.defaultVariant;
    const explicitClassification = directWorkflowCommands[variant];
    return {
        mode: "full",
        normalizedRequest: request,
        explicitClassification,
    };
}
export function parseMode(input) {
    const trimmedInput = input.trim();
    const publicCommand = "/pipeline-orchestrator-for-codex:pipeline";
    const directWorkflow = parseDirectWorkflowCommand(trimmedInput);
    if (directWorkflow) {
        return directWorkflow;
    }
    const prefixes = [
        { prefix: `${publicCommand} diagnostic `, mode: "diagnostic" },
        { prefix: `${publicCommand} continue`, mode: "continue" },
        { prefix: `${publicCommand} review-only `, mode: "review-only" },
        { prefix: `${publicCommand} --simples `, mode: "--simples" },
        { prefix: `${publicCommand} --media `, mode: "--media" },
        { prefix: `${publicCommand} --complexa `, mode: "--complexa" },
        { prefix: `${publicCommand} --plan `, mode: "--plan" },
        { prefix: `${publicCommand} --grill `, mode: "--grill" },
        { prefix: `${publicCommand} --hotfix `, mode: "--hotfix" },
        { prefix: "/pipeline diagnostic ", mode: "diagnostic" },
        { prefix: "/pipeline continue", mode: "continue" },
        { prefix: "/pipeline review-only ", mode: "review-only" },
        { prefix: "/pipeline --simples ", mode: "--simples" },
        { prefix: "/pipeline --media ", mode: "--media" },
        { prefix: "/pipeline --complexa ", mode: "--complexa" },
        { prefix: "/pipeline --plan ", mode: "--plan" },
        { prefix: "/pipeline --grill ", mode: "--grill" },
        { prefix: "/pipeline --hotfix ", mode: "--hotfix" },
    ];
    for (const { prefix, mode } of prefixes) {
        if (trimmedInput === prefix.trimEnd()) {
            return { mode, normalizedRequest: "" };
        }
        if (trimmedInput.startsWith(prefix)) {
            return {
                mode,
                normalizedRequest: trimmedInput.slice(prefix.length).trimStart(),
            };
        }
    }
    if (trimmedInput.startsWith(`${publicCommand} `)) {
        return {
            mode: "full",
            normalizedRequest: trimmedInput.slice(`${publicCommand} `.length).trimStart(),
        };
    }
    if (trimmedInput.startsWith("/pipeline ")) {
        return {
            mode: "full",
            normalizedRequest: trimmedInput.slice("/pipeline ".length).trimStart(),
        };
    }
    return {
        mode: "full",
        normalizedRequest: trimmedInput,
    };
}
