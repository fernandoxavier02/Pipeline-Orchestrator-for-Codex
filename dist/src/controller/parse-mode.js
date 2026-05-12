export function parseMode(input) {
    const trimmedInput = input.trim();
    const publicCommand = "/pipeline-orchestrator-for-codex:pipeline";
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
