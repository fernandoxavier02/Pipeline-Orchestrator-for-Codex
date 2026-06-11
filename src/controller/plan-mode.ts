import type { PipelineMode } from "../domain/pipeline-types.js";
import type { PipelineComplexity } from "./classification-overrides.js";
import type { ProposalConfirmationStatus } from "./confirm-proposal.js";

export type PlanModeStatus = "required" | "optional" | "skipped";

export interface PlanModeBypass {
  attempted: boolean;
  honored: boolean;
  reason: string;
}

export interface ChangeContract {
  allowed_files: string[];
  allowed_new_files: string[];
  forbidden_files: string[];
  forbidden_change_types: string[];
  diff_budget: {
    max_files_expected: number;
    max_lines_expected: number;
    new_abstractions_allowed: boolean;
    new_modules_allowed: boolean;
  };
  escalation_required_if: string[];
  bootstrap: {
    active: boolean;
  };
}

export interface PlanModeRequest {
  kind: "PLAN_MODE_REQUEST";
  protocol_version: 1;
  source: "pipeline-controller";
  plan_id: string;
  research_scope: string;
  expected_deliverables: string[];
}

export interface ImplementationPlan {
  kind: "IMPLEMENTATION_PLAN";
  status: ProposalConfirmationStatus;
  summary: string;
  affectedFiles: string[];
  CHANGE_CONTRACT: ChangeContract;
  tasks: string[];
  risks: string[];
  approvalNotes: string;
}

export function getPlanModeStatus(mode: PipelineMode, complexity: PipelineComplexity): PlanModeStatus {
  if (mode === "--plan") {
    return "required";
  }

  if (mode === "--no-plan") {
    return complexity === "COMPLEXA" ? "required" : "skipped";
  }

  if (complexity === "COMPLEXA") {
    return "required";
  }

  return "skipped";
}

export function getPlanModeBypass(mode: PipelineMode, complexity: PipelineComplexity): PlanModeBypass | undefined {
  if (mode !== "--no-plan") {
    return undefined;
  }

  const honored = complexity !== "COMPLEXA";
  return {
    attempted: true,
    honored,
    reason: honored
      ? "--no-plan honored for non-COMPLEXA workflow; bypass remains explicit in proposal/session state."
      : "--no-plan ignored for COMPLEXA workflow; Plan Mode remains required.",
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "request";
}

export function createPlanModeRequest(input: {
  request: string;
  variant: string;
  affectedFiles: string[];
}): PlanModeRequest {
  return {
    kind: "PLAN_MODE_REQUEST",
    protocol_version: 1,
    source: "pipeline-controller",
    plan_id: `plan-${slugify(input.variant)}-${slugify(input.request)}`,
    research_scope: `Plan the ${input.variant} workflow before execution: ${input.request}`,
    expected_deliverables: [
      "Confirmed workflow and user-approved adjustments",
      "PDD: visible update_plan protocol before editing, dispatching, or claiming completion",
      "DDD: domain boundaries, invariants, and SSOT ownership before implementation choices",
      "ATDD: acceptance criteria or report acceptance checks before execution",
      "TDD: failing test or report-only evidence-first equivalent before change/claim",
      "Batch plan with checkpoint validation and adversarial review after every batch",
      `Affected files: ${input.affectedFiles.length > 0 ? input.affectedFiles.join(", ") : "to be discovered"}`,
    ],
  };
}

export function renderPlanModeRequestBlock(request: PlanModeRequest) {
  const lines = [
    "=== PLAN_MODE_REQUEST v1 ===",
    `kind: ${request.kind}`,
    `protocol_version: ${request.protocol_version}`,
    `source: ${request.source}`,
    `plan_id: ${JSON.stringify(request.plan_id)}`,
    `research_scope: ${JSON.stringify(request.research_scope)}`,
    "expected_deliverables:",
    ...request.expected_deliverables.map((deliverable) => `  - ${JSON.stringify(deliverable)}`),
    "=== END PLAN_MODE_REQUEST ===",
  ];

  return lines.join("\n");
}

export function createImplementationPlan(input: {
  status: ProposalConfirmationStatus;
  summary?: string;
  affectedFiles?: string[];
  variant?: string;
  validationIntent?: "standard" | "reduced";
  changeContract?: ChangeContract;
}): ImplementationPlan {
  const variant = input.variant ?? "feature-light";
  const affectedFiles = input.affectedFiles ?? [];
  const changeContract = input.changeContract ?? createChangeContract({
    affectedFiles,
    batchSize: Math.max(1, affectedFiles.length),
  });

  return {
    kind: "IMPLEMENTATION_PLAN",
    status: input.status,
    summary: input.summary ?? "Implementation plan ready for approval.",
    affectedFiles,
    CHANGE_CONTRACT: changeContract,
    tasks: [
      "Confirm the failing or review-driving scenarios before implementation.",
      "Implement the scoped change in the affected files.",
      "Run verification and capture approval evidence for the batch.",
    ],
    risks: [
      variant.startsWith("audit-") || variant.startsWith("adversarial-")
        ? "State transitions or persistence can drift from the intended pipeline behavior."
        : "Implementation scope can drift if the affected files expand without updating the batch plan.",
      "Review evidence can become stale if the touched files expand during execution.",
      input.validationIntent === "reduced"
        ? "Reduced validation lowers ceremony and needs an explicit blocker justification."
        : "Verification gaps can invalidate the plan if the expected regression surface is not exercised.",
    ],
    approvalNotes:
      input.status === "APPROVED"
        ? "Controller-approved plan is ready for execution once RED proof exists."
        : input.status === "ADJUSTED"
          ? "Plan needs adjustment before execution can proceed."
        : "Plan was rejected and must not proceed to execution.",
  };
}

export function createChangeContract(input: {
  affectedFiles: string[];
  batchSize: number;
}): ChangeContract {
  const allowedFiles = [...new Set(input.affectedFiles)].sort();
  return {
    allowed_files: allowedFiles,
    allowed_new_files: [],
    forbidden_files: [
      "dist/**",
      ".git/**",
      "node_modules/**",
    ],
    forbidden_change_types: [
      "unrequested_feature",
      "unrelated_refactor",
      "new_dependency_without_approval",
      "public_api_contract_change_without_approval",
      "schema_migration_without_approval",
      "sensitive_config_change_without_approval",
      "test_weakened_to_fit_implementation",
    ],
    diff_budget: {
      max_files_expected: Math.max(1, allowedFiles.length || input.batchSize),
      max_lines_expected: Math.max(30, Math.max(1, allowedFiles.length || input.batchSize) * 80),
      new_abstractions_allowed: false,
      new_modules_allowed: false,
    },
    escalation_required_if: [
      "actual diff exceeds the declared budget by more than 20 percent",
      "files outside allowed_files or allowed_new_files are touched",
      "dependency, config, public API, schema, secret, or test-integrity changes appear",
    ],
    bootstrap: {
      active: false,
    },
  };
}
