export const MANUAL_FALLBACK_NOTICE = "This is a manual fallback review, not a valid pipeline execution.";
export const REQUIRED_PIPELINE_CAPABILITIES = [
    "spawn_agent",
    "wait_agent",
    "subagent_artifact_collection",
    "gate_recording",
    "hook_checkpoint_recording",
    "structured_final_state",
];
export const REQUIRED_PIPELINE_GATES = [
    "CAPABILITY_GATE",
    "INTAKE_GATE",
    "SCOPE_GATE",
    "EVIDENCE_GATE",
    "ADVERSARIAL_GATE",
    "FINAL_VERDICT_GATE",
];
const CHECKPOINT_PHASES = [
    "intake",
    "planning",
    "agent_dispatch",
    "artifact_collection",
    "adversarial_review",
    "final_verdict",
];
export const REQUIRED_PIPELINE_HOOKS = CHECKPOINT_PHASES.flatMap((phase) => [
    `${phase}:before`,
    `${phase}:after`,
]);
export function isExplicitPipelineRequest(input) {
    const trimmed = input.trim();
    return trimmed.startsWith("/pipeline-orchestrator-for-codex:pipeline")
        || /^\/pipeline-orchestrator-for-codex:(audit|audit-light|audit-heavy|bugfix|bugfix-light|bugfix-heavy|feature|feature-light|feature-heavy|review|spec|spec-light|spec-heavy|spec-audit-only|paperclip-audit|paperclip-bugfix|paperclip-feature|paperclip-hotfix|paperclip-review|paperclip-spec|paperclip-user-story|paperclip-ux|setup-paperclip)(?:\s|$)/u.test(trimmed)
        || /^(paperclip-audit|paperclip-bugfix|paperclip-feature|paperclip-hotfix|paperclip-review|paperclip-spec|paperclip-user-story|paperclip-ux|setup-paperclip)(?:\s|$)/u.test(trimmed)
        || trimmed.startsWith("PRE_CLASSIFIED_TYPE=");
}
function hasCapability(runtime, capability) {
    const adapter = runtime?.agentRuntime;
    const declared = adapter?.capabilities;
    switch (capability) {
        case "spawn_agent":
            return typeof adapter?.spawnAgent === "function";
        case "wait_agent":
            return typeof adapter?.waitAgent === "function";
        case "subagent_artifact_collection":
            return typeof adapter?.collectArtifacts === "function";
        case "gate_recording":
            return typeof runtime?.stores?.gateLog?.append === "function";
        case "hook_checkpoint_recording":
            return typeof runtime?.stores?.checkpoints?.save === "function";
        case "structured_final_state":
            return declared?.structuredFinalState === true;
        default: {
            const exhaustive = capability;
            return exhaustive;
        }
    }
}
export function evaluateCapabilities(runtime) {
    const missing_capabilities = REQUIRED_PIPELINE_CAPABILITIES.filter((capability) => !hasCapability(runtime, capability));
    const runtime_mode = runtime?.runtimeMode
        ?? runtime?.agentRuntime?.runtimeMode
        ?? (runtime?.agentRuntime ? "real-agent" : "blocked-no-agent-runtime");
    const bypassActive = runtime_mode === "dev-bypass" || runtime_mode === "harness";
    const status = missing_capabilities.length === 0 && !bypassActive ? "PASS" : "BLOCKED";
    return {
        status,
        runtime_mode,
        missing_capabilities,
        gate: {
            gate: bypassActive ? "BYPASS_MODE_ACTIVE" : "CAPABILITY_GATE",
            status,
            reason: status === "PASS"
                ? "All mandatory pipeline runtime capabilities are available."
                : bypassActive
                    ? `Runtime mode ${runtime_mode} is not valid for production pipeline execution.`
                    : `Missing mandatory pipeline runtime capabilities: ${missing_capabilities.join(", ")}`,
            evidence_ref: "runtime.capabilities",
        },
    };
}
export function createManualFallbackArtifact() {
    return {
        kind: "manual_fallback_not_pipeline",
        notice: MANUAL_FALLBACK_NOTICE,
        allowed: true,
        counts_as_pipeline: false,
        recommendation: "Re-run the pipeline when the complete real-agent runtime is available.",
    };
}
export function createBlockedPipelineArtifact(input) {
    const reason = input.reason ?? "blocked-no-agent-runtime";
    const gate = input.capabilityGate ?? {
        gate: "CAPABILITY_GATE",
        status: "BLOCKED",
        reason,
        evidence_ref: "runtime.capabilities",
    };
    return {
        pipeline_requested: true,
        pipeline_valid: false,
        runtime_mode: input.runtime_mode ?? (reason === "dev-bypass" ? "dev-bypass" : "blocked-no-agent-runtime"),
        hook_enforcement_mode: "advisory",
        exec_window_enforcement: "cooperative",
        status: "BLOCKED",
        reason,
        missing_capabilities: input.missing_capabilities ?? [],
        gates: [gate],
        hooks: [],
        agents: [],
        manual_fallback: createManualFallbackArtifact(),
        manual_fallback_allowed: true,
        manual_fallback_counts_as_pipeline: false,
        final_verdict: {
            status: "BLOCKED",
            reason,
            evidence_ref: gate.evidence_ref,
        },
        input: input.request,
    };
}
function presentStatuses(items) {
    return items.length > 0 && items.every((item) => item.status === "PASS");
}
export function requiredAgentRoles(input = {}) {
    return [
        ...(input.adversarial ? ["primary_reviewer", "adversarial_reviewer"] : []),
        ...(input.security ? ["security_reviewer"] : []),
    ];
}
export function validatePipelineArtifact(artifact, options = {}) {
    const gateById = new Map(artifact.gates.map((gate) => [gate.gate, gate]));
    const hookById = new Map(artifact.hooks.map((hook) => [hook.checkpoint, hook]));
    const agentByRole = new Map(artifact.agents.map((agent) => [agent.role, agent]));
    const missing_gates = REQUIRED_PIPELINE_GATES.filter((gate) => !gateById.has(gate));
    const missing_hooks = REQUIRED_PIPELINE_HOOKS.filter((hook) => !hookById.has(hook));
    const missing_agents = requiredAgentRoles(options).filter((role) => {
        const agent = agentByRole.get(role);
        return !agent || agent.status !== "PASS" || agent.independent !== true;
    });
    const gateFailures = artifact.gates.filter((gate) => gate.status !== "PASS");
    const hookFailures = artifact.hooks.filter((hook) => hook.status !== "PASS");
    const verdictBlocked = artifact.final_verdict.status !== "PASS";
    const pipeline_valid = artifact.pipeline_requested === true
        && artifact.runtime_mode === "real-agent"
        && artifact.hook_enforcement_mode === "blocking"
        && artifact.exec_window_enforcement === "cooperative"
        && artifact.status === "PASS"
        && artifact.missing_capabilities.length === 0
        && missing_gates.length === 0
        && missing_hooks.length === 0
        && missing_agents.length === 0
        && presentStatuses(artifact.gates)
        && presentStatuses(artifact.hooks)
        && !verdictBlocked
        && artifact.manual_fallback_counts_as_pipeline === false;
    return {
        status: pipeline_valid ? "PASS" : "BLOCKED",
        pipeline_valid,
        missing_gates,
        missing_hooks,
        missing_agents,
        gate_failures: gateFailures.map((gate) => gate.gate),
        hook_failures: hookFailures.map((hook) => hook.checkpoint),
        final_verdict_status: artifact.final_verdict.status,
    };
}
export function createPassingPipelineArtifact(input = {}) {
    if (input.testOnly !== true) {
        return {
            pipeline_requested: true,
            pipeline_valid: false,
            runtime_mode: "harness",
            hook_enforcement_mode: "advisory",
            exec_window_enforcement: "cooperative",
            status: "BLOCKED",
            reason: "createPassingPipelineArtifact requires testOnly=true and must not mint production PASS artifacts.",
            missing_capabilities: [],
            gates: [],
            hooks: [],
            agents: [],
            manual_fallback: createManualFallbackArtifact(),
            manual_fallback_allowed: true,
            manual_fallback_counts_as_pipeline: false,
            final_verdict: {
                status: "BLOCKED",
                reason: "testOnly flag required for synthetic PASS helper.",
                evidence_ref: "createPassingPipelineArtifact",
            },
        };
    }
    const artifact = {
        pipeline_requested: true,
        pipeline_valid: true,
        runtime_mode: "real-agent",
        hook_enforcement_mode: "blocking",
        exec_window_enforcement: "cooperative",
        status: "PASS",
        missing_capabilities: [],
        gates: input.gates ?? REQUIRED_PIPELINE_GATES.map((gate) => ({
            gate,
            status: "PASS",
            reason: `${gate} passed.`,
            evidence_ref: `gate:${gate}`,
        })),
        hooks: input.hooks ?? REQUIRED_PIPELINE_HOOKS.map((checkpoint) => ({
            checkpoint,
            status: "PASS",
            reason: `${checkpoint} checkpoint recorded.`,
            evidence_ref: `checkpoint:${checkpoint}`,
        })),
        agents: input.agents ?? [
            {
                role: "primary_reviewer",
                status: "PASS",
                dispatch_ref: "dispatch:primary_reviewer",
                independent: true,
            },
            {
                role: "adversarial_reviewer",
                status: "PASS",
                dispatch_ref: "dispatch:adversarial_reviewer",
                independent: true,
            },
        ],
        manual_fallback: createManualFallbackArtifact(),
        manual_fallback_allowed: true,
        manual_fallback_counts_as_pipeline: false,
        final_verdict: {
            status: "PASS",
            reason: "All mandatory pipeline governance checks passed.",
            evidence_ref: "final_verdict",
        },
    };
    const validation = validatePipelineArtifact(artifact, {
        adversarial: true,
        security: artifact.agents.some((agent) => agent.role === "security_reviewer"),
    });
    if (!validation.pipeline_valid) {
        return {
            ...artifact,
            pipeline_valid: false,
            status: "BLOCKED",
            reason: "pipeline-artifact-validation-failed",
            final_verdict: {
                status: "BLOCKED",
                reason: [
                    "Pipeline artifact failed validation before PASS.",
                    validation.missing_gates.length > 0 ? `Missing gates: ${validation.missing_gates.join(", ")}` : "",
                    validation.missing_hooks.length > 0 ? `Missing hooks: ${validation.missing_hooks.join(", ")}` : "",
                    validation.missing_agents.length > 0 ? `Missing agents: ${validation.missing_agents.join(", ")}` : "",
                ].filter(Boolean).join(" "),
                evidence_ref: "validatePipelineArtifact",
            },
        };
    }
    return artifact;
}
