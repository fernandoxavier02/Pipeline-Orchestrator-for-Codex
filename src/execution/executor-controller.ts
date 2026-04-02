import { runAdversarialReview } from "../review/adversarial-review.js";
import { runRole } from "../dispatcher/run-role.js";
import type { PipelineComplexity, ValidationIntent } from "../controller/classification-overrides.js";
import { createCheckpointValidator, type CheckpointValidationResult } from "./checkpoint-validator.js";
import { createPreTester } from "./pre-tester.js";
import { createQualityGateRouter, type PlannedBatch, type PlannedExecution } from "./quality-gate-router.js";

type ExecutionBatch = {
  name: string;
  files: string[];
};

async function defaultRunBatch(batch: ExecutionBatch) {
  const execution = await runRole({
    mode: "single-agent",
    role: "executor-implementer",
    prompt: "Implement only the current batch.",
    input: { batch },
  });

  const review = await runAdversarialReview({
    batch,
    findings: [],
  });

  return {
    execution,
    review,
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

export function createExecutorController(dependencies: ExecutorControllerDependencies = {}) {
  const runBatch = dependencies.runBatch ?? defaultRunBatch;
  const qualityGateRouter = dependencies.qualityGateRouter ?? createQualityGateRouter();
  const preTester = dependencies.preTester ?? createPreTester();
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
        : qualityGateRouter.planBatches({
            complexity,
            tasks,
            mode: input.mode,
            validationIntent: input.proposal?.validationIntent,
          });
      const proof = preTester.deriveExecutionProof({
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
        execution: unknown;
        review: unknown;
        checkpoint: CheckpointValidationResult;
      }> = [];
      const checkpointEvidence: Array<{
        batchName: string;
        requiredCheckpoints: number;
        verifiedCheckpoints: number;
        evidence: string[];
      }> = [];
      const appliedFixAttempts: boolean[] = [];

      for (const [index, batch] of planned.batches.entries()) {
        const batchResult = await runBatch(toExecutionBatch(batch));
        const verificationEvidence = deriveControllerVerificationEvidence({
          approvedScenarios: proof.approvedScenarios,
          regressionProofs: planned.regressionProofs,
          batchResult,
        });
        const batchFixAttempts =
          batchResult && typeof batchResult === "object" && "fixAttempts" in batchResult && Array.isArray(batchResult.fixAttempts)
            ? batchResult.fixAttempts as boolean[]
            : [];
        const checkpoint = checkpointValidator.validateCheckpoints({
          verificationEvidence,
          checkpointName: batch.name,
        });
        checkpointEvidence.push({
          batchName: batch.name,
          requiredCheckpoints: checkpoint.requiredCheckpoints,
          verifiedCheckpoints: checkpoint.verifiedCheckpoints,
          evidence: verificationEvidence?.evidence ?? [],
        });

        batchResults.push({
          batch,
          execution: batchResult.execution && typeof batchResult.execution === "object"
            ? batchResult.execution
            : {},
          review: batchResult.review,
          checkpoint,
        });

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

        if (checkpoint.status === "failed" && batchFixAttempts.length > 0) {
          const fixLoopResult = await runFixLoop({
            strategy: "same-plan",
            attemptFix: ({ attempt }) => {
              const result = batchFixAttempts[attempt - 1] ?? false;
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

      return {
        status: "completed",
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
        review: lastResult?.review ?? null,
        validation: lastResult?.checkpoint ?? null,
        proof: {
          ...proof,
          checkpointEvidence,
          fixAttempts: appliedFixAttempts,
        },
        batches: planned.batches,
        results: batchResults,
      };
    },
    runFixLoop,
  };
}
