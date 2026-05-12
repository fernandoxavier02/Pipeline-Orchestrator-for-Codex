export type WorkflowStatus = "passed" | "blocked" | "needs-user" | "skipped";

export type WorkflowComplexity = "SIMPLES" | "MEDIA" | "COMPLEXA";

export type WorkflowNextStepMode = "auto" | "suggest" | "blocked" | "stop";

export type WorkflowId =
  | "audit"
  | "audit-heavy"
  | "audit-light"
  | "brainstorm"
  | "bugfix"
  | "bugfix-heavy"
  | "bugfix-light"
  | "feature"
  | "feature-heavy"
  | "feature-light"
  | "help"
  | "pipeline"
  | "review"
  | "spec"
  | "spec-audit-only"
  | "spec-design"
  | "spec-heavy"
  | "spec-init"
  | "spec-light"
  | "spec-requirements"
  | "spec-tasks"
  | "validate-design"
  | "validate-gap"
  | "verify-completion";

type WorkflowTarget = WorkflowId | null | ((context: NextStepContext) => WorkflowId | null);

export type WorkflowNextStepRule = Readonly<{
  workflow: WorkflowId;
  next: WorkflowTarget;
  reason: string;
  defaultMode: Exclude<WorkflowNextStepMode, "blocked">;
  requiresApproval: boolean;
}>;

export type NextStepContext = Readonly<{
  workflow: WorkflowId;
  status: WorkflowStatus;
  runId?: string;
  complexity?: WorkflowComplexity;
  allowAutoAdvance?: boolean;
}>;

export type NextStepDecision = Readonly<{
  status: WorkflowStatus;
  currentWorkflow: WorkflowId;
  nextWorkflow: WorkflowId | null;
  mode: WorkflowNextStepMode;
  command: string | null;
  reason: string;
  requiresApproval: boolean;
}>;

function implementationVariant(context: NextStepContext): WorkflowId {
  return context.complexity === "COMPLEXA" ? "feature-heavy" : "feature-light";
}

function bugfixVariant(context: NextStepContext): WorkflowId {
  return context.complexity === "COMPLEXA" ? "bugfix-heavy" : "bugfix-light";
}

function auditVariant(context: NextStepContext): WorkflowId {
  return context.complexity === "COMPLEXA" ? "audit-heavy" : "audit-light";
}

function specExecutionVariant(context: NextStepContext): WorkflowId {
  return context.complexity === "COMPLEXA" ? "spec-heavy" : "spec-light";
}

export const WORKFLOW_NEXT_STEPS: Readonly<Record<WorkflowId, WorkflowNextStepRule>> = Object.freeze({
  audit: {
    workflow: "audit",
    next: auditVariant,
    reason: "Audit shortcut classified; run the selected audit depth.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "audit-heavy": {
    workflow: "audit-heavy",
    next: "verify-completion",
    reason: "Heavy audit report finished; verify the completion claim before closing.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "audit-light": {
    workflow: "audit-light",
    next: "verify-completion",
    reason: "Light audit report finished; verify the completion claim before closing.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  brainstorm: {
    workflow: "brainstorm",
    next: "spec-init",
    reason: "Brainstorm captured intent and created the run directory; initialize the spec artifacts next.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  bugfix: {
    workflow: "bugfix",
    next: bugfixVariant,
    reason: "Bugfix shortcut classified; run the selected fix depth.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "bugfix-heavy": {
    workflow: "bugfix-heavy",
    next: "review",
    reason: "Heavy bugfix implementation finished; review the implementation before final verification.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "bugfix-light": {
    workflow: "bugfix-light",
    next: "review",
    reason: "Light bugfix implementation finished; review the implementation before final verification.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  feature: {
    workflow: "feature",
    next: implementationVariant,
    reason: "Feature shortcut classified; run the selected feature depth.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "feature-heavy": {
    workflow: "feature-heavy",
    next: "review",
    reason: "Heavy feature implementation finished; review the implementation before final verification.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "feature-light": {
    workflow: "feature-light",
    next: "review",
    reason: "Light feature implementation finished; review the implementation before final verification.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  help: {
    workflow: "help",
    next: null,
    reason: "Help is informational; invoke the recommended command explicitly when ready.",
    defaultMode: "stop",
    requiresApproval: false,
  },
  pipeline: {
    workflow: "pipeline",
    next: "verify-completion",
    reason: "Pipeline run finished; verify the final completion claim from fresh evidence.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  review: {
    workflow: "review",
    next: "verify-completion",
    reason: "Review finished; verify the completion claim before GO.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  spec: {
    workflow: "spec",
    next: specExecutionVariant,
    reason: "Spec shortcut classified; run the selected spec execution depth.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "spec-audit-only": {
    workflow: "spec-audit-only",
    next: "verify-completion",
    reason: "Spec audit finished; verify the final audit completion claim.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "spec-design": {
    workflow: "spec-design",
    next: "validate-design",
    reason: "Design was generated; validate it before task generation.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "spec-heavy": {
    workflow: "spec-heavy",
    next: "verify-completion",
    reason: "Heavy spec execution finished; verify completion before closeout.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "spec-init": {
    workflow: "spec-init",
    next: "spec-requirements",
    reason: "Spec shell was initialized; generate requirements next.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "spec-light": {
    workflow: "spec-light",
    next: "verify-completion",
    reason: "Light spec execution finished; verify completion before closeout.",
    defaultMode: "suggest",
    requiresApproval: false,
  },
  "spec-requirements": {
    workflow: "spec-requirements",
    next: "spec-design",
    reason: "Requirements were generated; create the technical design next.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "spec-tasks": {
    workflow: "spec-tasks",
    next: specExecutionVariant,
    reason: "Tasks were generated; execute the spec with the selected depth.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "validate-design": {
    workflow: "validate-design",
    next: "spec-tasks",
    reason: "Design validation passed; generate implementation tasks next.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "validate-gap": {
    workflow: "validate-gap",
    next: "spec-design",
    reason: "Gap analysis finished; update or generate design from the findings.",
    defaultMode: "suggest",
    requiresApproval: true,
  },
  "verify-completion": {
    workflow: "verify-completion",
    next: null,
    reason: "Completion has been verified; no automatic next workflow remains.",
    defaultMode: "stop",
    requiresApproval: false,
  },
});

function commandFor(workflow: WorkflowId, context: NextStepContext): string {
  const argument = context.runId ?? context.workflow;
  return `/pipeline-orchestrator-for-codex:${workflow} ${argument}`;
}

function resolveTarget(target: WorkflowTarget, context: NextStepContext): WorkflowId | null {
  return typeof target === "function" ? target(context) : target;
}

export function resolveNextStep(context: NextStepContext): NextStepDecision {
  const rule = WORKFLOW_NEXT_STEPS[context.workflow];

  if (context.status === "blocked") {
    return {
      status: context.status,
      currentWorkflow: context.workflow,
      nextWorkflow: context.workflow,
      mode: "blocked",
      command: commandFor(context.workflow, context),
      reason: "Current workflow is blocked; fix the blocker and rerun the same workflow before advancing.",
      requiresApproval: true,
    };
  }

  if (context.status === "needs-user") {
    return {
      status: context.status,
      currentWorkflow: context.workflow,
      nextWorkflow: context.workflow,
      mode: "suggest",
      command: commandFor(context.workflow, context),
      reason: "Current workflow needs user input before it can advance.",
      requiresApproval: true,
    };
  }

  const nextWorkflow = resolveTarget(rule.next, context);

  if (!nextWorkflow || rule.defaultMode === "stop") {
    return {
      status: context.status,
      currentWorkflow: context.workflow,
      nextWorkflow: null,
      mode: "stop",
      command: null,
      reason: rule.reason,
      requiresApproval: false,
    };
  }

  const mode = context.allowAutoAdvance && !rule.requiresApproval ? "auto" : rule.defaultMode;

  return {
    status: context.status,
    currentWorkflow: context.workflow,
    nextWorkflow,
    mode,
    command: commandFor(nextWorkflow, context),
    reason: rule.reason,
    requiresApproval: rule.requiresApproval,
  };
}

export function renderNextStepBlock(decision: NextStepDecision): string {
  const nextWorkflow = decision.nextWorkflow ?? "none";
  const command = decision.command ?? "none";

  return [
    "NEXT_STEP:",
    `  status: ${decision.status}`,
    `  current_workflow: ${decision.currentWorkflow}`,
    `  mode: ${decision.mode}`,
    `  next_workflow: ${nextWorkflow}`,
    `  command: ${command}`,
    `  requires_approval: ${decision.requiresApproval ? "true" : "false"}`,
    `  reason: ${decision.reason}`,
  ].join("\n");
}
