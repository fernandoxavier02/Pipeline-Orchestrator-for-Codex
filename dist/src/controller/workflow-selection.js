const WORKFLOW_OPTIONS = [
    {
        command: "yes",
        label: "Confirmar",
        description: "Mantem o workflow escolhido e avanca para planejamento/aprovacao.",
    },
    {
        command: "adjust",
        label: "Ajustar",
        description: "Pede ajuste manual antes de prosseguir.",
    },
    {
        command: "no",
        label: "Cancelar",
        description: "Interrompe o pipeline antes da execucao.",
    },
    {
        command: "audit",
        label: "Audit",
        description: "Troca para revisao/auditoria sem editar producao.",
    },
    {
        command: "bugfix",
        label: "Bug Fix",
        description: "Troca para correcao de defeito com regressao focada.",
    },
    {
        command: "feature",
        label: "Implement",
        description: "Troca para implementacao de funcionalidade.",
    },
    {
        command: "ux",
        label: "UX",
        description: "Troca para fluxo de simulacao/revisao de experiencia.",
    },
    {
        command: "spec",
        label: "Spec",
        description: "Troca para execucao orientada por spec/Kiro.",
    },
];
const TYPE_LABELS = {
    Feature: "Implement / Feature",
    "Bug Fix": "Bug Fix",
    "User Story": "User Story",
    Audit: "Audit",
    "UX Simulation": "UX",
    Spec: "Spec",
};
const TYPE_ALIASES = {
    implement: "Feature",
    implementation: "Feature",
    implementar: "Feature",
    feature: "Feature",
    funcionalidade: "Feature",
    bugfix: "Bug Fix",
    "bug-fix": "Bug Fix",
    "bug fix": "Bug Fix",
    fix: "Bug Fix",
    bug: "Bug Fix",
    correcao: "Bug Fix",
    "correcao de bug": "Bug Fix",
    audit: "Audit",
    auditoria: "Audit",
    ux: "UX Simulation",
    "ux simulation": "UX Simulation",
    "simulacao ux": "UX Simulation",
    story: "User Story",
    "user story": "User Story",
    spec: "Spec",
    kiro: "Spec",
    quiro: "Spec",
};
const VARIANT_TO_TYPE = {
    "implement-light": "Feature",
    "implement-heavy": "Feature",
    "feature-light": "Feature",
    "feature-heavy": "Feature",
    "bugfix-light": "Bug Fix",
    "bugfix-heavy": "Bug Fix",
    "audit-light": "Audit",
    "audit-heavy": "Audit",
    "user-story-light": "User Story",
    "user-story-heavy": "User Story",
    "ux-sim-light": "UX Simulation",
    "ux-sim-heavy": "UX Simulation",
    "spec-light": "Spec",
    "spec-heavy": "Spec",
    "spec-audit-only": "Spec",
};
function workflowLabel(classification) {
    return `${TYPE_LABELS[classification.type]} (${classification.variant})`;
}
function isHeavy(complexity) {
    return complexity === "COMPLEXA";
}
export function defaultBatchSizeForWorkflow(classification) {
    if (isHeavy(classification.complexity)) {
        return 1;
    }
    if (classification.type === "Feature" || classification.type === "User Story" || classification.type === "UX Simulation") {
        return 3;
    }
    return 2;
}
function variantFor(type, complexity, explicitVariant) {
    if (explicitVariant === "spec-audit-only") {
        return explicitVariant;
    }
    const intensity = isHeavy(complexity) ? "heavy" : "light";
    if (type === "Feature") {
        return `implement-${intensity}`;
    }
    if (type === "Bug Fix") {
        return `bugfix-${intensity}`;
    }
    if (type === "Audit") {
        return `audit-${intensity}`;
    }
    if (type === "User Story") {
        return `user-story-${intensity}`;
    }
    if (type === "UX Simulation") {
        return `ux-sim-${intensity}`;
    }
    return `spec-${intensity}`;
}
export function buildWorkflowSelection(input) {
    const label = workflowLabel(input.classification);
    const reason = input.profileSummary
        ?? `Classificado automaticamente como ${label} pela solicitacao do usuario.`;
    return {
        status: "awaiting-user-confirmation",
        selectedWorkflow: {
            type: input.classification.type,
            complexity: input.classification.complexity,
            variant: input.classification.variant,
            label,
            reason,
        },
        message: [
            "WORKFLOW SELECTED",
            `  Type: ${input.classification.type}`,
            `  Complexity: ${input.classification.complexity}`,
            `  Pipeline: ${input.classification.variant}`,
            `  Reason: ${reason}`,
        ].join("\n"),
        question: `Quer manter esse workflow (${label}) para "${input.request}"? Responda "yes" para manter, "adjust" para ajustar manualmente, ou envie audit, bugfix, feature, ux ou spec para trocar.`,
        options: WORKFLOW_OPTIONS,
    };
}
function normalizeSwitchResponse(response) {
    return response
        .trim()
        .toLowerCase()
        .replace(/^\/pipeline\s+/, "")
        .replace(/^workflow\s*[:=]\s*/, "")
        .replace(/^modo\s*[:=]\s*/, "")
        .replace(/^trocar\s+(para|por)\s+/, "")
        .replace(/^usar\s+/, "")
        .trim();
}
export function resolveWorkflowSwitch(input) {
    const normalized = normalizeSwitchResponse(input.response);
    const currentComplexity = input.current?.complexity ?? (input.current?.variant?.endsWith("-heavy") ? "COMPLEXA" : "MEDIA");
    const explicitType = VARIANT_TO_TYPE[normalized];
    if (explicitType) {
        const explicitComplexity = normalized.endsWith("-heavy")
            ? "COMPLEXA"
            : normalized.endsWith("-light")
                ? "MEDIA"
                : currentComplexity;
        return {
            type: explicitType,
            complexity: explicitComplexity,
            variant: variantFor(explicitType, explicitComplexity, normalized),
        };
    }
    const type = TYPE_ALIASES[normalized];
    if (!type) {
        return undefined;
    }
    return {
        type,
        complexity: currentComplexity,
        variant: variantFor(type, currentComplexity),
    };
}
