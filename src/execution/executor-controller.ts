import { runAdversarialReview } from "../review/adversarial-review.js";
import { createFinalAdversarialOrchestrator } from "../review/final-adversarial-orchestrator.js";
import { createReviewOrchestrator } from "../review/review-orchestrator.js";
import { detectChangedDomains } from "../review/domain-checklists.js";
import { runRole } from "../dispatcher/run-role.js";
import type { PipelineComplexity, ValidationIntent } from "../controller/classification-overrides.js";
import { createCheckpointValidator, type CheckpointValidationResult } from "./checkpoint-validator.js";
import { createPreTester } from "./pre-tester.js";
import { createQualityGateRouter, type PlannedBatch, type PlannedExecution } from "./quality-gate-router.js";

type ExecutionBatch = {
  name: string;
  files: string[];
};

const authoritativeFinalReviewResultSymbol = Symbol("authoritative-final-review-result");

function normalizeFiles(files: unknown) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .filter((file): file is string => typeof file === "string" && file.length > 0)
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file, index, values) => values.indexOf(file) === index);
}

function extractExecutionChangedFiles(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidateKeys = ["changedFiles", "modifiedFiles", "touchedFiles", "affectedFiles", "files"] as const;
  for (const key of candidateKeys) {
    if (key in payload) {
      const files = normalizeFiles((payload as Record<string, unknown>)[key]);
      if (files.length > 0) {
        return files;
      }
    }
  }

  if ("output" in payload && payload.output && typeof payload.output === "object") {
    return extractExecutionChangedFiles(payload.output);
  }

  return [];
}

function createMissingChangedFilesReview(batch: ExecutionBatch) {
  return {
    batch: batch.name,
    files: [],
    changedDomains: [],
    checklists: [],
    required: true,
    gate: "ADVERSARIAL_SCOPE_MISSING",
    decision: "block",
    status: "blocked",
    findings: [
      {
        severity: "important",
        summary: `Executor changed-file evidence is required before adversarial review can validate ${batch.name}.`,
        file: batch.files[0] ?? "unknown-file",
      },
    ],
    strategy: "missing-changed-file-evidence",
  };
}

function summarizeEffectiveReview(review: unknown) {
  if (!review || typeof review !== "object") {
    return {
      status: "approved",
      findings: [] as Array<{ severity: string }>,
    };
  }

  const candidate = review as {
    status?: unknown;
    findings?: unknown;
  };

  return {
    status: typeof candidate.status === "string" ? candidate.status : "approved",
    findings: Array.isArray(candidate.findings)
      ? candidate.findings as Array<{ severity: string }>
      : [],
  };
}

function resolveReworkFindings(review: unknown) {
  if (!review || typeof review !== "object") {
    return undefined;
  }

  const candidate = review as {
    findings?: unknown;
    reviews?: unknown;
  };
  const directReviewerFindings = Array.isArray(candidate.reviews)
    ? candidate.reviews
      .filter((entry): entry is { reviewer?: unknown; status?: unknown; findings?: unknown } => !!entry && typeof entry === "object")
      .filter((entry) =>
        typeof entry.reviewer === "string"
        && ["batch-reviewer", "executor-spec-reviewer", "quality-reviewer"].includes(entry.reviewer),
      )
      .flatMap((entry) =>
        Array.isArray(entry.findings)
          ? entry.findings.filter((finding): finding is Record<string, unknown> => !!finding && typeof finding === "object")
          : [],
      )
    : [];

  if (directReviewerFindings.length > 0) {
    return directReviewerFindings;
  }

  return Array.isArray(candidate.findings)
    ? candidate.findings.filter((finding): finding is Record<string, unknown> => !!finding && typeof finding === "object")
    : undefined;
}

function isCheckpointStatus(value: unknown): value is CheckpointValidationResult["status"] {
  return value === "passed" || value === "failed" || value === "STOP_RULE";
}

function parseCheckpointValidationResult(output: unknown): CheckpointValidationResult | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const candidate = output as Record<string, unknown>;
  const status = candidate.status ?? candidate.STATUS;
  const checkpointName = candidate.checkpointName ?? candidate.CHECKPOINT_RESULT;

  if (
    !isCheckpointStatus(status)
    || typeof checkpointName !== "string"
    || typeof candidate.consecutiveFailures !== "number"
    || typeof candidate.requiredCheckpoints !== "number"
    || typeof candidate.verifiedCheckpoints !== "number"
    || typeof candidate.coverage !== "number"
  ) {
    return undefined;
  }

  return {
    status,
    checkpointName,
    consecutiveFailures: candidate.consecutiveFailures,
    requiredCheckpoints: candidate.requiredCheckpoints,
    verifiedCheckpoints: candidate.verifiedCheckpoints,
    coverage: candidate.coverage,
  };
}

function isPreTesterStatus(value: unknown): value is "approved" | "blocked" {
  return value === "approved" || value === "blocked";
}

function isTddApproval(value: unknown): value is "APPROVED" | "REJECTED" {
  return value === "APPROVED" || value === "REJECTED";
}

function parsePreTesterProof(output: unknown): ReturnType<ReturnType<typeof createPreTester>["deriveExecutionProof"]> | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const candidate = output as Record<string, unknown>;
  const approvedScenarios = Array.isArray(candidate.approvedScenarios)
    ? candidate.approvedScenarios.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const tddApproval = candidate.tddApproval;
  const redValidation = candidate.redValidation;
  const redValidationRecord = redValidation && typeof redValidation === "object"
    ? redValidation as Record<string, unknown>
    : undefined;
  const reasons = Array.isArray(redValidationRecord?.reasons)
    ? redValidationRecord.reasons.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  if (
    !approvedScenarios
    || !isTddApproval(tddApproval)
    || !redValidationRecord
    || !isPreTesterStatus(redValidationRecord.status)
    || !reasons
  ) {
    return undefined;
  }

  return {
    approvedScenarios,
    tddApproval,
    redValidation: {
      status: redValidationRecord.status,
      reasons,
    },
  };
}

function parseQualityGatePlan(output: unknown): PlannedExecution | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const candidate = output as Record<string, unknown>;
  const batchSize = candidate.batchSize;
  const regressionProofs = candidate.regressionProofs;
  const approvedScenarios = Array.isArray(candidate.approvedScenarios)
    ? candidate.approvedScenarios.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const batches = Array.isArray(candidate.batches)
    ? candidate.batches
      .filter((entry): entry is { name: string; tasks: string[] } =>
        !!entry
        && typeof entry === "object"
        && typeof (entry as { name?: unknown }).name === "string"
        && Array.isArray((entry as { tasks?: unknown }).tasks)
        && (entry as { tasks: unknown[] }).tasks.every((task) => typeof task === "string"))
      .map((entry) => ({
        name: entry.name,
        tasks: entry.tasks,
      }))
    : undefined;

  if (
    typeof batchSize !== "number"
    || typeof regressionProofs !== "number"
    || !approvedScenarios
    || !batches
  ) {
    return undefined;
  }

  return {
    batchSize,
    regressionProofs,
    approvedScenarios,
    batches,
  };
}

function parseExecutorFixResult(output: unknown): { status: string; success: boolean } | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const candidate = output as Record<string, unknown>;
  const status = candidate.status ?? candidate.FIX_RESULT;

  if (typeof status !== "string" || status.length === 0) {
    return undefined;
  }

  return {
    status,
    success: status === "fixed",
  };
}

async function defaultRunBatch(
  batch: ExecutionBatch,
  dependencies?: {
    runRole?: typeof runRole;
    adversarialReview?: typeof runAdversarialReview;
    mode?: string;
  },
) {
  const executeRole = dependencies?.runRole ?? runRole;
  const adversarialReview = dependencies?.adversarialReview ?? runAdversarialReview;
  const execution = await executeRole({
    mode: "single-agent",
    role: "executor-implementer",
    prompt: "Implement only the current batch.",
    input: { batch },
  });
  const changedFiles = extractExecutionChangedFiles(execution) ?? [];

  if (changedFiles.length === 0) {
    return {
      execution,
      review: createMissingChangedFilesReview(batch),
      changedFiles: [],
      verificationEvidence:
        execution.output
        && typeof execution.output === "object"
        && "verificationEvidence" in execution.output
          ? execution.output.verificationEvidence
          : undefined,
    };
  }

  const review = await adversarialReview({
    batch,
    changedFiles,
    mode: dependencies?.mode,
  });

  return {
    execution,
    review,
    changedFiles,
    verificationEvidence:
      execution.output
      && typeof execution.output === "object"
      && "verificationEvidence" in execution.output
        ? execution.output.verificationEvidence
        : undefined,
  };
}

function toExecutionBatch(batch: PlannedBatch | ExecutionBatch): ExecutionBatch {
  return {
    name: batch.name,
    files: [...("tasks" in batch ? batch.tasks : batch.files)],
  };
}

function toPlannedBatch(batch: PlannedBatch | ExecutionBatch): PlannedBatch {
  return {
    name: batch.name,
    tasks: [...("tasks" in batch ? batch.tasks : batch.files)],
  };
}

function resolveComplexity(input: {
  mode?: string;
  complexity?: PipelineComplexity;
  variant?: string;
}): PipelineComplexity {
  if (input.complexity) {
    return input.complexity;
  }

  if (input.mode === "--complexa" || input.mode === "--plan" || input.mode === "--hotfix") {
    return "COMPLEXA";
  }

  if (input.mode === "--simples") {
    return "SIMPLES";
  }

  if (input.mode === "--media") {
    return "MEDIA";
  }

  return input.variant?.endsWith("heavy") ? "COMPLEXA" : "MEDIA";
}

function normalizeScenarioPath(path: string) {
  return path.replace(/\\/g, "/");
}

function deriveControllerVerificationEvidence(input: {
  approvedScenarios: string[];
  regressionProofs: number;
  batchResult: unknown;
}) {
  const approvedScenarios = new Set(input.approvedScenarios.map(normalizeScenarioPath));
  const rawEvidence =
    input.batchResult && typeof input.batchResult === "object" && "verificationEvidence" in input.batchResult
      ? input.batchResult.verificationEvidence as {
          scenarios?: string[];
          evidence?: string[];
        } | undefined
      : undefined;
  const candidateScenarios = [
    ...(rawEvidence?.scenarios ?? []),
    ...(rawEvidence?.evidence ?? []),
  ]
    .map(normalizeScenarioPath)
    .filter((scenario, index, scenarios) => scenarios.indexOf(scenario) === index);
  const verifiedScenarios = candidateScenarios.filter((scenario) => approvedScenarios.has(scenario));
  const requiredCheckpoints = Math.max(1, Math.min(input.regressionProofs, approvedScenarios.size || 1));

  return {
    requiredCheckpoints,
    verifiedCheckpoints: Math.min(verifiedScenarios.length, requiredCheckpoints),
    evidence: verifiedScenarios,
  };
}

function markAuthoritativeFinalReviewResult<T extends object>(result: T): T {
  Object.defineProperty(result, authoritativeFinalReviewResultSymbol, {
    value: true,
    enumerable: false,
  });

  return result;
}

export function hasAuthoritativeFinalReviewResult(result: unknown) {
  return !!result && typeof result === "object" && authoritativeFinalReviewResultSymbol in result;
}

export interface ExecuteApprovedWorkInput {
  batch?: ExecutionBatch;
  mode?: string;
  phase?: string;
  complexity?: PipelineComplexity;
  variant?: string;
  proposal?: {
    summary: string;
    affectedFiles: string[];
    validationIntent: ValidationIntent;
    batchSize: number;
  };
  tasks?: string[];
  tddApproval?: "APPROVED" | "ADJUSTED" | "REJECTED";
  redValidation?: {
    status: "approved" | "blocked";
    reasons: string[];
  };
  approvedScenarios?: string[];
  workingDirectory?: string;
  stores?: {
    checkpoints?: {
      save?: (checkpoint: unknown) => Promise<void>;
    };
    session?: {
      save?: (session: unknown) => Promise<void>;
    };
  };
}

export interface ExecutorControllerDependencies {
  runBatch?: typeof defaultRunBatch;
  runRole?: typeof runRole;
  adversarialReview?: typeof runAdversarialReview;
  finalAdversarialOrchestrator?: (input: {
    scope: { files: string[] };
    changedDomains?: string[];
    reviews?: Array<{ reviewer: string; status: string; findings: Array<{ severity: string }> }>;
  }) => Promise<any>;
  reviewOrchestrator?: {
    reviewBatch: (input: {
      batch: { name: string; files: string[] };
      changedDomains?: string[];
      changedFiles?: string[];
      mode?: string;
    }) => Promise<any>;
  };
  qualityGateRouter?: ReturnType<typeof createQualityGateRouter>;
  preTester?: ReturnType<typeof createPreTester>;
  checkpointValidator?: ReturnType<typeof createCheckpointValidator> | {
    reset?: () => void;
    validateCheckpoints: (input: {
      verificationEvidence?: {
        requiredCheckpoints: number;
        verifiedCheckpoints: number;
        evidence: string[];
      };
      checkpointName: string;
    }) => CheckpointValidationResult;
  };
}

async function dispatchExecutorFix(input: {
  runRole?: typeof runRole;
  batch: ExecutionBatch;
  attempt: number;
  strategy: string;
  findings?: unknown;
  changedDomains?: string[];
}) {
  if (!input.runRole) {
    return undefined;
  }

  return input.runRole({
    mode: "single-agent",
    role: "executor-fix",
    prompt: "Apply the current finding set from fresh context within the approved batch scope.",
    input: {
      batch: {
        name: input.batch.name,
        files: [...input.batch.files],
      },
      files: [...input.batch.files],
      changedDomains: [...(input.changedDomains ?? [])],
      findings: input.findings,
      attempt: input.attempt,
      strategy: input.strategy,
    },
    filesInScope: [...input.batch.files],
    authorityLevel: "executor",
    freshContext: true,
    reviewOnly: false,
  });
}

async function resolveCheckpointValidation(input: {
  runRole?: typeof runRole;
  checkpointValidator: ReturnType<typeof createCheckpointValidator> | {
    reset?: () => void;
    validateCheckpoints: (input: {
      verificationEvidence?: {
        requiredCheckpoints: number;
        verifiedCheckpoints: number;
        evidence: string[];
      };
      checkpointName: string;
    }) => CheckpointValidationResult;
  };
  batch: ExecutionBatch;
  verificationEvidence: {
    requiredCheckpoints: number;
    verifiedCheckpoints: number;
    evidence: string[];
  };
  checkpointName: string;
  previousFailures: number;
}) {
  if (!input.runRole) {
    return input.checkpointValidator.validateCheckpoints({
      verificationEvidence: input.verificationEvidence,
      checkpointName: input.checkpointName,
    });
  }

  const dispatch = await input.runRole({
    mode: "single-agent",
    role: "checkpoint-validator",
    prompt: "Validate proportional per-batch evidence before the checkpoint can pass.",
    input: {
      verificationEvidence: input.verificationEvidence,
      checkpointName: input.checkpointName,
      previousFailures: input.previousFailures,
    },
    filesInScope: [...input.batch.files],
    authorityLevel: "controller",
    freshContext: true,
    reviewOnly: false,
  });
  const parsed = parseCheckpointValidationResult(dispatch.output);

  if (!parsed) {
    throw new Error("checkpoint-validator returned an invalid runtime result");
  }

  return parsed;
}

async function resolvePreTesterProof(input: {
  runRole?: typeof runRole;
  preTester: ReturnType<typeof createPreTester>;
  filesInScope: string[];
  approvedScenarios: string[];
  cwd?: string;
}) {
  if (!input.runRole) {
    return input.preTester.deriveExecutionProof({
      approvedScenarios: input.approvedScenarios,
      cwd: input.cwd,
    });
  }

  const dispatch = await input.runRole({
    mode: "single-agent",
    role: "pre-tester",
    prompt: "Validate TDD proof and RED readiness before any implementation batch proceeds.",
    input: {
      approvedScenarios: input.approvedScenarios,
      cwd: input.cwd,
    },
    filesInScope: [...input.filesInScope],
    authorityLevel: "controller",
    freshContext: true,
    reviewOnly: false,
  });
  const parsed = parsePreTesterProof(dispatch.output);

  if (!parsed) {
    throw new Error("pre-tester returned an invalid runtime result");
  }

  return parsed;
}

async function resolveQualityGatePlan(input: {
  runRole?: typeof runRole;
  qualityGateRouter: ReturnType<typeof createQualityGateRouter>;
  complexity: PipelineComplexity;
  tasks: string[];
  mode?: string;
  validationIntent?: ValidationIntent;
}) {
  if (!input.runRole) {
    return input.qualityGateRouter.planBatches({
      complexity: input.complexity,
      tasks: input.tasks,
      mode: input.mode,
      validationIntent: input.validationIntent,
    });
  }

  const dispatch = await input.runRole({
    mode: "single-agent",
    role: "quality-gate-router",
    prompt: "Plan proportional Phase 2 batches and regression proof depth from the approved task set.",
    input: {
      complexity: input.complexity,
      tasks: input.tasks,
      mode: input.mode,
      validationIntent: input.validationIntent,
    },
    filesInScope: [...input.tasks],
    authorityLevel: "controller",
    freshContext: true,
    reviewOnly: false,
  });
  const parsed = parseQualityGatePlan(dispatch.output);

  if (!parsed) {
    throw new Error("quality-gate-router returned an invalid runtime result");
  }

  return parsed;
}

export function createExecutorController(dependencies: ExecutorControllerDependencies = {}): {
  executeApprovedWork: (input: ExecuteApprovedWorkInput) => Promise<any>;
  runFixLoop: (input: {
    strategy: string;
    attemptFix: (input: { attempt: number; strategy: string }) => Promise<boolean> | boolean;
  }) => Promise<{ status: "FIXED"; attempts: number; strategy: string } | { status: "FIX_LOOP_EXHAUSTED"; attempts: number; strategyChangeRequired: boolean }>;
} {
  const runBatch = dependencies.runBatch ?? ((batch: ExecutionBatch) => defaultRunBatch(batch, {
    runRole: dependencies.runRole,
    adversarialReview: dependencies.adversarialReview,
    mode: currentExecutionMode,
  }));
  const qualityGateRouter = dependencies.qualityGateRouter ?? createQualityGateRouter();
  const preTester = dependencies.preTester ?? createPreTester();
  const finalAdversarialOrchestrator = dependencies.finalAdversarialOrchestrator
    ?? ((input: { scope: { files: string[] }; changedDomains?: string[] }) =>
      createFinalAdversarialOrchestrator().reviewFinal(input));
  const reviewOrchestrator = dependencies.reviewOrchestrator
    ?? createReviewOrchestrator({
      runRole: dependencies.runRole,
    });
  let currentExecutionMode: string | undefined;
  const runFixLoop = async (input: {
    strategy: string;
    attemptFix: (input: { attempt: number; strategy: string }) => Promise<boolean> | boolean;
  }) => {
    let strategy = input.strategy;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const success = await input.attemptFix({ attempt, strategy });
      if (success) {
        return {
          status: "FIXED" as const,
          attempts: attempt,
          strategy,
        };
      }

      if (attempt === 2) {
        strategy = "strategy-change-required";
      }
    }

    return {
      status: "FIX_LOOP_EXHAUSTED" as const,
      attempts: 3,
      strategyChangeRequired: true,
    };
  };

  return {
    async executeApprovedWork(input: ExecuteApprovedWorkInput) {
      currentExecutionMode = input.mode;
      const checkpointValidator = dependencies.checkpointValidator ?? createCheckpointValidator();
      checkpointValidator.reset?.();
      const tasks = input.batch?.files ?? input.tasks ?? input.proposal?.affectedFiles ?? [];
      const complexity = resolveComplexity({
        mode: input.mode,
        complexity: input.complexity,
        variant: input.variant,
      });

      const planned: PlannedExecution = input.batch
        ? {
            batchSize: input.batch.files.length || 1,
            regressionProofs:
              input.mode === "--hotfix" || input.proposal?.validationIntent === "reduced"
                ? 1
                : 2,
            approvedScenarios: [...(input.approvedScenarios ?? [])],
            batches: [toPlannedBatch(input.batch)],
          }
        : await resolveQualityGatePlan({
            runRole: dependencies.runRole,
            qualityGateRouter,
            complexity,
            tasks,
            mode: input.mode,
            validationIntent: input.proposal?.validationIntent,
          });
      const proof = await resolvePreTesterProof({
        runRole: dependencies.runRole,
        preTester,
        filesInScope: input.batch?.files ?? tasks,
        approvedScenarios: input.approvedScenarios ?? [],
        cwd: input.workingDirectory,
      });

      if (proof.tddApproval !== "APPROVED") {
        return {
          status: "blocked",
          blockedBy: "TDD_APPROVAL",
          planned,
          proof: {
            ...proof,
            checkpointEvidence: [],
            fixAttempts: [],
          },
        };
      }

      if (proof.redValidation.status === "blocked") {
        return {
          status: "blocked",
          blockedBy: "RED_VALIDATION",
          reasons: proof.redValidation.reasons,
          planned,
          proof: {
            ...proof,
            checkpointEvidence: [],
            fixAttempts: [],
          },
        };
      }

      const batchResults: Array<{
        batch: PlannedBatch;
        changedFiles: string[];
        execution: unknown;
        review: unknown;
        batchReview?: unknown;
        checkpoint: CheckpointValidationResult;
      }> = [];
      const checkpointEvidence: Array<{
        batchName: string;
        requiredCheckpoints: number;
        verifiedCheckpoints: number;
        evidence: string[];
      }> = [];
      const appliedFixAttempts: boolean[] = [];
      let checkpointFailureCount = 0;

      for (const [index, batch] of planned.batches.entries()) {
        const executionBatch = toExecutionBatch(batch);
        const batchResult = await runBatch(executionBatch);
        const actualChangedFiles = extractExecutionChangedFiles(batchResult);
        const verificationEvidence = deriveControllerVerificationEvidence({
          approvedScenarios: proof.approvedScenarios,
          regressionProofs: planned.regressionProofs,
          batchResult,
        });
        const batchFixAttempts =
          batchResult && typeof batchResult === "object" && "fixAttempts" in batchResult && Array.isArray(batchResult.fixAttempts)
            ? batchResult.fixAttempts as boolean[]
            : [];
        const checkpoint = await resolveCheckpointValidation({
          runRole: dependencies.runRole,
          checkpointValidator,
          batch: executionBatch,
          verificationEvidence,
          checkpointName: batch.name,
          previousFailures: checkpointFailureCount,
        });
        checkpointFailureCount = checkpoint.status === "passed" ? 0 : checkpoint.consecutiveFailures;
        const changedDomains = detectChangedDomains(
          actualChangedFiles.length > 0 ? actualChangedFiles : executionBatch.files,
        );
        const batchReview = await reviewOrchestrator.reviewBatch({
          batch: {
            name: batch.name,
            files: actualChangedFiles.length > 0 ? actualChangedFiles : executionBatch.files,
          },
          changedFiles: actualChangedFiles,
          changedDomains,
          mode: input.mode,
        });
        checkpointEvidence.push({
          batchName: batch.name,
          requiredCheckpoints: checkpoint.requiredCheckpoints,
          verifiedCheckpoints: checkpoint.verifiedCheckpoints,
          evidence: verificationEvidence?.evidence ?? [],
        });

        if (actualChangedFiles.length === 0) {
          const missingEvidenceReview = createMissingChangedFilesReview(executionBatch);
          batchResults.push({
            batch,
            changedFiles: [],
            execution: batchResult.execution && typeof batchResult.execution === "object"
              ? batchResult.execution
              : {},
            review: missingEvidenceReview,
            batchReview,
            checkpoint,
          });

          return {
            status: "blocked",
            blockedBy: "ADVERSARIAL_SCOPE_MISSING",
            batchSize: planned.batchSize,
            regressionProofs: planned.regressionProofs,
            execution: batchResult.execution,
            review: missingEvidenceReview,
            validation: checkpoint,
            proof: {
              ...proof,
              checkpointEvidence,
              fixAttempts: appliedFixAttempts,
            },
            batches: planned.batches,
            results: batchResults,
          };
        }

        batchResults.push({
          batch,
          changedFiles: actualChangedFiles,
          execution: batchResult.execution && typeof batchResult.execution === "object"
            ? batchResult.execution
            : {},
          review: batchResult.review,
          batchReview,
          checkpoint,
        });

        if (
          batchResult.review
          && typeof batchResult.review === "object"
          && "status" in batchResult.review
          && batchResult.review.status === "blocked"
        ) {
          return {
            status: "blocked",
            blockedBy: "ADVERSARIAL_BLOCK",
            batchSize: planned.batchSize,
            regressionProofs: planned.regressionProofs,
            execution: batchResult.execution,
            review: batchResult.review,
            validation: checkpoint,
            proof: {
              ...proof,
              checkpointEvidence,
              fixAttempts: appliedFixAttempts,
            },
            batches: planned.batches,
            results: batchResults,
          };
        }

        await input.stores?.checkpoints?.save?.({
          name: batch.name,
          phase: input.phase ?? "phase-2",
          batchIndex: index,
          status: checkpoint.status === "passed" ? "completed" : "failed",
          timestamp: new Date().toISOString(),
          detail:
            checkpoint.status === "passed"
              ? "Checkpoint verified proportionally"
              : checkpoint.status === "STOP_RULE"
                ? "Checkpoint validation exhausted the stop rule"
              : "Checkpoint validation failed",
        });

        if (
          batchReview
          && typeof batchReview === "object"
          && "status" in batchReview
          && batchReview.status === "blocked"
        ) {
          if (batchFixAttempts.length > 0) {
            const fixLoopResult = await runFixLoop({
              strategy: "independent-review-rework",
              attemptFix: async ({ attempt, strategy }) => {
                const fixDispatch = await dispatchExecutorFix({
                  runRole: dependencies.runRole,
                  batch: executionBatch,
                  attempt,
                  strategy,
                  findings: resolveReworkFindings(batchReview),
                  changedDomains,
                });
                const structuredResult = parseExecutorFixResult(
                  fixDispatch && typeof fixDispatch === "object" && "output" in fixDispatch
                    ? fixDispatch.output
                    : undefined,
                );
                const result = structuredResult?.success ?? (batchFixAttempts[attempt - 1] ?? false);
                appliedFixAttempts.push(result);
                return result;
              },
            });

            if (fixLoopResult.status === "FIX_LOOP_EXHAUSTED") {
              return {
                status: "FIX_LOOP_EXHAUSTED",
                attempts: fixLoopResult.attempts,
                strategyChangeRequired: fixLoopResult.strategyChangeRequired,
                batchSize: planned.batchSize,
                regressionProofs: planned.regressionProofs,
                execution: {
                  ...((batchResult.execution && typeof batchResult.execution === "object")
                    ? batchResult.execution
                    : {}),
                  batchSize: planned.batchSize,
                  regressionProofs: planned.regressionProofs,
                },
                review: batchResult.review,
                batchReview,
                validation: checkpoint,
                proof: {
                  ...proof,
                  checkpointEvidence,
                  fixAttempts: appliedFixAttempts,
                },
                batches: planned.batches,
                results: batchResults,
              };
            }
          }

          return {
            status: "blocked",
            blockedBy: "BATCH_REVIEW_REWORK",
            batchSize: planned.batchSize,
            regressionProofs: planned.regressionProofs,
            execution: batchResult.execution,
            review: batchResult.review,
            batchReview,
            validation: checkpoint,
            proof: {
              ...proof,
              checkpointEvidence,
              fixAttempts: appliedFixAttempts,
            },
            batches: planned.batches,
            results: batchResults,
          };
        }

        if (checkpoint.status === "failed" && batchFixAttempts.length > 0) {
          const fixLoopResult = await runFixLoop({
            strategy: "same-plan",
            attemptFix: async ({ attempt, strategy }) => {
              const fixDispatch = await dispatchExecutorFix({
                runRole: dependencies.runRole,
                batch: executionBatch,
                attempt,
                strategy,
                findings:
                  batchResult.review && typeof batchResult.review === "object" && "findings" in batchResult.review
                    ? batchResult.review.findings
                    : undefined,
                changedDomains,
              });
              const structuredResult = parseExecutorFixResult(
                fixDispatch && typeof fixDispatch === "object" && "output" in fixDispatch
                  ? fixDispatch.output
                  : undefined,
              );
              const result = structuredResult?.success ?? (batchFixAttempts[attempt - 1] ?? false);
              appliedFixAttempts.push(result);
              return result;
            },
          });

          if (fixLoopResult.status === "FIX_LOOP_EXHAUSTED") {
            return {
              status: "FIX_LOOP_EXHAUSTED",
              attempts: fixLoopResult.attempts,
              strategyChangeRequired: fixLoopResult.strategyChangeRequired,
              batchSize: planned.batchSize,
              regressionProofs: planned.regressionProofs,
              execution: {
                ...((batchResult.execution && typeof batchResult.execution === "object")
                  ? batchResult.execution
                  : {}),
                batchSize: planned.batchSize,
                regressionProofs: planned.regressionProofs,
              },
              review: batchResult.review,
              validation: checkpoint,
              proof: {
                ...proof,
                checkpointEvidence,
                fixAttempts: appliedFixAttempts,
              },
              batches: planned.batches,
              results: batchResults,
            };
          }
        }

        if (checkpoint.status === "STOP_RULE") {
          return {
            status: "STOP_RULE",
            batchSize: planned.batchSize,
            regressionProofs: planned.regressionProofs,
            execution: {
              ...((batchResult.execution && typeof batchResult.execution === "object")
                ? batchResult.execution
                : {}),
              batchSize: planned.batchSize,
              regressionProofs: planned.regressionProofs,
            },
            review: batchResult.review,
            validation: checkpoint,
            proof: {
              ...proof,
              checkpointEvidence,
              fixAttempts: appliedFixAttempts,
            },
            batches: planned.batches,
            results: batchResults,
          };
        }

        if (checkpoint.status === "failed" && index === planned.batches.length - 1) {
          return {
            status: "failed",
            batchSize: planned.batchSize,
            regressionProofs: planned.regressionProofs,
            execution: {
              ...((batchResult.execution && typeof batchResult.execution === "object")
                ? batchResult.execution
                : {}),
              batchSize: planned.batchSize,
              regressionProofs: planned.regressionProofs,
            },
            review: batchResult.review,
            validation: checkpoint,
            proof: {
              ...proof,
              checkpointEvidence,
              fixAttempts: appliedFixAttempts,
            },
            batches: planned.batches,
            results: batchResults,
          };
        }
      }

      const lastResult = batchResults.at(-1);
      const finalScopeFiles = normalizeFiles(batchResults.flatMap((result) => result.changedFiles));
      const finalReview = await finalAdversarialOrchestrator({
        scope: {
          files: finalScopeFiles.length > 0 ? finalScopeFiles : tasks,
        },
        changedDomains: detectChangedDomains(finalScopeFiles.length > 0 ? finalScopeFiles : tasks),
        reviews: batchResults.map((result) => {
          const effectiveReview = summarizeEffectiveReview(result.batchReview ?? result.review);
          return {
            reviewer: result.batch.name,
            status: effectiveReview.status,
            findings: effectiveReview.findings,
          };
        }),
      });

      if (finalReview.status === "rework" || finalReview.finalDecision === "blocked") {
        return {
          status: "blocked",
          blockedBy: "FINAL_ADVERSARIAL_REWORK",
          batchSize: planned.batchSize,
          regressionProofs: planned.regressionProofs,
          execution: lastResult?.execution ?? null,
          review: lastResult?.batchReview ?? lastResult?.review ?? null,
          finalReview,
          validation: lastResult?.checkpoint ?? null,
          proof: {
            ...proof,
            checkpointEvidence,
            fixAttempts: appliedFixAttempts,
          },
          batches: planned.batches,
          results: batchResults,
        };
      }

      return markAuthoritativeFinalReviewResult({
        status: "completed" as const,
        batchSize: planned.batchSize,
        regressionProofs: planned.regressionProofs,
        execution: lastResult
          ? {
              ...((lastResult.execution && typeof lastResult.execution === "object")
              ? lastResult.execution
                : {}),
              batchSize: planned.batchSize,
              regressionProofs: planned.regressionProofs,
            }
          : null,
        review: lastResult?.batchReview ?? lastResult?.review ?? null,
        finalReview,
        validation: lastResult?.checkpoint ?? null,
        proof: {
          ...proof,
          checkpointEvidence,
          fixAttempts: appliedFixAttempts,
        },
        batches: planned.batches,
        results: batchResults,
      });
    },
    runFixLoop,
  };
}
