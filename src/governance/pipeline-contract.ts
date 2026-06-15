import type { AgentRuntimeAdapter, DispatchResult } from "../dispatcher/dispatcher-types.js";
import {
  REQUIRED_WORKFLOW_GATES,
  REQUIRED_WORKFLOW_HOOKS,
  evaluateWorkflowEvidence,
  requiredWorkflowEventsFromArtifact,
} from "./workflow-enforcement.js";

export const MANUAL_FALLBACK_NOTICE =
  "This is a manual fallback review, not a valid pipeline execution.";

export const REQUIRED_PIPELINE_CAPABILITIES = [
  "spawn_agent",
  "wait_agent",
  "subagent_artifact_collection",
  "gate_recording",
  "hook_checkpoint_recording",
  "structured_final_state",
] as const;

export const REQUIRED_PIPELINE_GATES = REQUIRED_WORKFLOW_GATES;
export const REQUIRED_PIPELINE_HOOKS = REQUIRED_WORKFLOW_HOOKS;

export type PipelineCapability = typeof REQUIRED_PIPELINE_CAPABILITIES[number];
export type PipelineGateId = typeof REQUIRED_PIPELINE_GATES[number];
export type PipelineHookId = typeof REQUIRED_PIPELINE_HOOKS[number];
export type PipelineContractStatus = "PASS" | "FAIL" | "BLOCKED";
export type PipelineRuntimeMode = "real-agent" | "harness" | "blocked-no-agent-runtime" | "dev-bypass";
export type HookEnforcementMode = "advisory" | "blocking";

export interface PipelineGateArtifact {
  gate: PipelineGateId | string;
  status: PipelineContractStatus;
  reason: string;
  evidence_ref: string;
}

export interface PipelineHookArtifact {
  checkpoint: PipelineHookId | string;
  status: PipelineContractStatus;
  reason: string;
  evidence_ref: string;
}

export interface PipelineAgentArtifact {
  role: string;
  status: PipelineContractStatus;
  dispatch_ref: string;
  independent: boolean;
}

export interface ManualFallbackArtifact {
  kind: "manual_fallback_not_pipeline";
  notice: typeof MANUAL_FALLBACK_NOTICE;
  allowed: boolean;
  counts_as_pipeline: false;
  recommendation: string;
}

export interface PipelineFinalVerdict {
  status: PipelineContractStatus;
  reason: string;
  evidence_ref: string;
}

export interface PipelineGovernanceArtifact {
  pipeline_requested: boolean;
  pipeline_valid: boolean;
  runtime_mode: PipelineRuntimeMode;
  hook_enforcement_mode: HookEnforcementMode;
  exec_window_enforcement: "cooperative";
  status: PipelineContractStatus;
  reason?: string;
  missing_capabilities: PipelineCapability[];
  gates: PipelineGateArtifact[];
  hooks: PipelineHookArtifact[];
  agents: PipelineAgentArtifact[];
  manual_fallback: ManualFallbackArtifact;
  manual_fallback_allowed: true;
  manual_fallback_counts_as_pipeline: false;
  final_verdict: PipelineFinalVerdict;
  input?: string;
}

export interface PipelineCapabilityRuntime {
  agentRuntime?: AgentRuntimeAdapter;
  runtimeMode?: PipelineRuntimeMode;
  stores?: {
    gateLog?: { append?: (decision: unknown) => Promise<void> };
    checkpoints?: { save?: (checkpoint: unknown) => Promise<void> };
  };
}

export function isExplicitPipelineRequest(input: string) {
  const trimmed = input.trim();
  return trimmed.startsWith("/pipeline-orchestrator-for-codex:pipeline")
    || /^\/pipeline-orchestrator-for-codex:(audit|audit-light|audit-heavy|bugfix|bugfix-light|bugfix-heavy|feature|feature-light|feature-heavy|review|spec|spec-light|spec-heavy|spec-audit-only|paperclip-audit|paperclip-bugfix|paperclip-feature|paperclip-hotfix|paperclip-review|paperclip-spec|paperclip-user-story|paperclip-ux|setup-paperclip)(?:\s|$)/u.test(trimmed)
    || /^(paperclip-audit|paperclip-bugfix|paperclip-feature|paperclip-hotfix|paperclip-review|paperclip-spec|paperclip-user-story|paperclip-ux|setup-paperclip)(?:\s|$)/u.test(trimmed)
    || trimmed.startsWith("PRE_CLASSIFIED_TYPE=");
}

function hasCapability(runtime: PipelineCapabilityRuntime | undefined, capability: PipelineCapability) {
  const adapter = runtime?.agentRuntime;
  const declared = adapter?.capabilities;

  switch (capability) {
    case "spawn_agent":
      return typeof adapter?.spawnAgent === "function";
    case "wait_agent":
      return typeof adapter?.waitAgent === "function" && declared?.waitAgent === true;
    case "subagent_artifact_collection":
      return typeof adapter?.collectArtifacts === "function" && declared?.collectArtifacts === true;
    case "gate_recording":
      return typeof runtime?.stores?.gateLog?.append === "function";
    case "hook_checkpoint_recording":
      return typeof runtime?.stores?.checkpoints?.save === "function";
    case "structured_final_state":
      return declared?.structuredFinalState === true;
    default: {
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}

export function evaluateCapabilities(runtime?: PipelineCapabilityRuntime) {
  const missing_capabilities = REQUIRED_PIPELINE_CAPABILITIES.filter(
    (capability) => !hasCapability(runtime, capability),
  );
  const runtime_mode: PipelineRuntimeMode = runtime?.runtimeMode
    ?? runtime?.agentRuntime?.runtimeMode
    ?? (runtime?.agentRuntime ? "real-agent" : "blocked-no-agent-runtime");
  const bypassActive = runtime_mode === "dev-bypass" || runtime_mode === "harness";
  const status: PipelineContractStatus = missing_capabilities.length === 0 && !bypassActive ? "PASS" : "BLOCKED";

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
    } satisfies PipelineGateArtifact,
  };
}

export function createManualFallbackArtifact(): ManualFallbackArtifact {
  return {
    kind: "manual_fallback_not_pipeline",
    notice: MANUAL_FALLBACK_NOTICE,
    allowed: true,
    counts_as_pipeline: false,
    recommendation: "Re-run the pipeline when the complete real-agent runtime is available.",
  };
}

export function createBlockedPipelineArtifact(input: {
  request?: string;
  reason?: string;
  runtime_mode?: PipelineRuntimeMode;
  missing_capabilities?: PipelineCapability[];
  capabilityGate?: PipelineGateArtifact;
}): PipelineGovernanceArtifact {
  const reason = input.reason ?? "blocked-no-agent-runtime";
  const gate = input.capabilityGate ?? {
    gate: "CAPABILITY_GATE",
    status: "BLOCKED",
    reason,
    evidence_ref: "runtime.capabilities",
  } satisfies PipelineGateArtifact;

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

function presentStatuses<T extends { status: PipelineContractStatus }>(items: T[]) {
  return items.length > 0 && items.every((item) => item.status === "PASS");
}

export function requiredAgentRoles(input: { adversarial?: boolean; security?: boolean } = {}) {
  return [
    ...(input.adversarial ? ["primary_reviewer", "adversarial_reviewer"] : []),
    ...(input.security ? ["security_reviewer"] : []),
  ];
}

export function validatePipelineArtifact(
  artifact: PipelineGovernanceArtifact,
  options: { adversarial?: boolean; security?: boolean } = {},
) {
  const workflowEvidence = evaluateWorkflowEvidence({
    events: requiredWorkflowEventsFromArtifact(artifact),
    requiredGates: REQUIRED_PIPELINE_GATES,
    requiredHooks: REQUIRED_PIPELINE_HOOKS,
    requireAdversarialReview: options.adversarial,
    requireSecurityReview: options.security,
  });
  const missing_gates = workflowEvidence.missingEvents
    .filter((event) => event.startsWith("gate:"))
    .map((event) => event.slice("gate:".length));
  const missing_hooks = workflowEvidence.missingEvents
    .filter((event) => event.startsWith("hook:"))
    .map((event) => event.slice("hook:".length));
  const missing_agents = workflowEvidence.missingEvents
    .filter((event) => event.startsWith("agent:"))
    .map((event) => event.slice("agent:".length));
  const gateFailures = artifact.gates.filter((gate) => gate.status !== "PASS");
  const hookFailures = artifact.hooks.filter((hook) => hook.status !== "PASS");
  const verdictBlocked = artifact.final_verdict.status !== "PASS";
  const pipeline_valid =
    artifact.pipeline_requested === true
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
    && workflowEvidence.status === "PASS"
    && !verdictBlocked
    && artifact.manual_fallback_counts_as_pipeline === false;

  return {
    status: pipeline_valid ? "PASS" as const : "BLOCKED" as const,
    pipeline_valid,
    missing_gates,
    missing_hooks,
    missing_agents,
    gate_failures: gateFailures.map((gate) => gate.gate),
    hook_failures: hookFailures.map((hook) => hook.checkpoint),
    final_verdict_status: artifact.final_verdict.status,
  };
}

export function createPassingPipelineArtifact(input: {
  testOnly?: boolean;
  gates?: PipelineGateArtifact[];
  hooks?: PipelineHookArtifact[];
  agents?: PipelineAgentArtifact[];
  dispatches?: DispatchResult[];
} = {}): PipelineGovernanceArtifact {
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

  const artifact: PipelineGovernanceArtifact = {
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
