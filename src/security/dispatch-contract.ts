/**
 * DispatchContract — DDD value object that ties an agent leaf name to its
 * pipeline-orchestrator-for-codex namespaced fully-qualified name.
 *
 * Rationale: callers must spawn pipeline agents through the Agent tool with
 * the FQN prefix `pipeline-orchestrator-for-codex:`. Calling a pipeline agent
 * via the Skill tool (or via Agent without the prefix) breaks dispatch
 * provenance and bypasses sentinel/edit-guard governance.
 */

export const PIPELINE_NAMESPACE = "pipeline-orchestrator-for-codex";

export type DispatchTool = "Agent" | "Skill";

export type DispatchContract = Readonly<{
  agentLeaf: string;
  fullyQualified: string; // "<namespace>:<folder>:<leaf>"
  tool: DispatchTool;
}>;

type FolderName = "core" | "quality" | "executor" | "executor/type-specific";

const RAW_AGENT_LEAVES: ReadonlyArray<readonly [FolderName, string]> = [
  ["core", "adversarial-batch"],
  ["core", "checkpoint-validator"],
  ["core", "final-validator"],
  ["core", "finishing-branch"],
  ["core", "information-gate"],
  ["core", "sanity-checker"],
  ["core", "sentinel"],
  ["core", "task-orchestrator"],
  ["executor", "executor-controller"],
  ["executor", "executor-fix"],
  ["executor", "executor-implementer-task"],
  ["executor", "executor-quality-reviewer"],
  ["executor", "executor-spec-reviewer"],
  ["executor/type-specific", "adversarial-architecture-critic"],
  ["executor/type-specific", "adversarial-review-coordinator"],
  ["executor/type-specific", "adversarial-security-scanner"],
  ["executor/type-specific", "audit-compliance-checker"],
  ["executor/type-specific", "audit-domain-analyzer"],
  ["executor/type-specific", "audit-intake"],
  ["executor/type-specific", "audit-risk-matrix-generator"],
  ["executor/type-specific", "bugfix-diagnostic-agent"],
  ["executor/type-specific", "bugfix-regression-tester"],
  ["executor/type-specific", "bugfix-root-cause-analyzer"],
  ["executor/type-specific", "feature-implementer"],
  ["executor/type-specific", "feature-integration-validator"],
  ["executor/type-specific", "feature-vertical-slice-planner"],
  ["executor/type-specific", "ux-accessibility-auditor"],
  ["executor/type-specific", "ux-qa-validator"],
  ["executor/type-specific", "ux-simulator"],
  ["quality", "architecture-reviewer"],
  ["quality", "design-interrogator"],
  ["quality", "final-adversarial-orchestrator"],
  ["quality", "plan-architect"],
  ["quality", "pre-tester"],
  ["quality", "quality-gate-router"],
  ["quality", "review-orchestrator"],
  // B9: adversarial-quality-reviewer (introduced in this batch series)
  ["quality", "adversarial-quality-reviewer"],
];

function buildFqn(folder: FolderName, leaf: string): string {
  return `${PIPELINE_NAMESPACE}:${folder}:${leaf}`;
}

const LEAF_TO_FQN_MAP: ReadonlyMap<string, string> = new Map(
  RAW_AGENT_LEAVES.map(([folder, leaf]) => [leaf, buildFqn(folder, leaf)] as const),
);

export const AGENT_LEAF_TO_FQN: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(LEAF_TO_FQN_MAP),
);

export function isPipelineAgentLeaf(name: string): boolean {
  return LEAF_TO_FQN_MAP.has(name);
}

export function fqnFor(leaf: string): string | undefined {
  return LEAF_TO_FQN_MAP.get(leaf);
}

export function isFullyQualifiedPipelineAgent(value: string): boolean {
  return value.startsWith(`${PIPELINE_NAMESPACE}:`);
}

export type DispatchVerdict =
  | { kind: "allow"; contract?: DispatchContract }
  | { kind: "block"; reason: string };

export function evaluateAgentDispatch(input: {
  subagentType: string | null | undefined;
}): DispatchVerdict {
  const value = (input.subagentType ?? "").trim();
  if (!value) {
    return { kind: "allow" }; // not a pipeline-orchestrator dispatch
  }

  if (isFullyQualifiedPipelineAgent(value)) {
    const leaf = value.split(":").pop() ?? "";
    if (!isPipelineAgentLeaf(leaf)) {
      return {
        kind: "block",
        reason:
          `DISPATCH_GUARD: subagent_type="${value}" uses the pipeline namespace ` +
          `but its leaf "${leaf}" is not a registered pipeline agent. ` +
          `Registered leaves: ${Array.from(LEAF_TO_FQN_MAP.keys()).join(", ")}.`,
      };
    }
    return {
      kind: "allow",
      contract: Object.freeze({
        agentLeaf: leaf,
        fullyQualified: value,
        tool: "Agent",
      }),
    };
  }

  // Bare leaf (no namespace) that maps to a pipeline agent → block.
  if (isPipelineAgentLeaf(value)) {
    return {
      kind: "block",
      reason:
        `DISPATCH_GUARD: subagent_type="${value}" is missing the namespace. ` +
        `Use Agent with subagent_type="${fqnFor(value)}" instead.`,
    };
  }

  // Other namespaces (e.g. another plugin) — pass through.
  return { kind: "allow" };
}

export function evaluateSkillDispatch(input: {
  skillName: string | null | undefined;
}): DispatchVerdict {
  const value = (input.skillName ?? "").trim();
  if (!value) {
    return { kind: "allow" };
  }
  // Match either bare leaf (e.g. "task-orchestrator") or namespaced leaf
  // (e.g. "pipeline-orchestrator-for-codex:core:task-orchestrator").
  const leaf = value.includes(":") ? value.split(":").pop() ?? "" : value;
  if (isPipelineAgentLeaf(leaf)) {
    return {
      kind: "block",
      reason:
        `DISPATCH_GUARD: Skill "${value}" maps to pipeline agent "${leaf}". ` +
        `Pipeline agents must be spawned via the Agent tool with ` +
        `subagent_type="${fqnFor(leaf)}", not via Skill.`,
    };
  }
  return { kind: "allow" };
}
