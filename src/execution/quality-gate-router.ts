import type { PipelineComplexity, ValidationIntent } from "../controller/classification-overrides.js";
import { reductionPolicyForMode } from "../modes/mode-policy.js";

export interface PlannedBatch {
  name: string;
  tasks: string[];
  parallel_eligible?: boolean;
  parallel_reason?: string;
}

export interface PlannedExecution {
  batchSize: number;
  regressionProofs: number;
  approvedScenarios: string[];
  batches: PlannedBatch[];
}

function chunkTasks(tasks: string[], batchSize: number) {
  const batches: PlannedBatch[] = [];

  for (let index = 0; index < tasks.length; index += batchSize) {
    const batchTasks = tasks.slice(index, index + batchSize);
    batches.push({
      name: `batch-${batches.length + 1}`,
      tasks: batchTasks,
      parallel_eligible: false,
      parallel_reason: batchTasks.length > 1
        ? "No validated file-scope proof; serial execution is the safe default."
        : "Single-task batch runs serially.",
    });
  }

  return batches;
}

export function planQualityGateBatches(input: {
  complexity: PipelineComplexity;
  tasks: string[];
  mode?: string;
  validationIntent?: ValidationIntent;
}): PlannedExecution {
  const tasks = [...input.tasks];
  const policy = reductionPolicyForMode(input.mode);
  const hotfixLike = policy !== null || input.validationIntent === "reduced";
  const policyBatchSize = policy?.batchSize;
  const batchSize =
    policyBatchSize !== undefined
      ? policyBatchSize
      : hotfixLike || input.complexity === "COMPLEXA"
        ? 1
        : input.complexity === "MEDIA"
          ? 3
          : Math.max(1, tasks.length);

  const batches =
    input.complexity === "SIMPLES"
      ? [
          {
            name: "batch-1",
            tasks,
            parallel_eligible: false,
            parallel_reason: "SIMPLES runs as one serial batch.",
          },
        ]
      : chunkTasks(tasks, batchSize);

  return {
    batchSize,
    regressionProofs: policy
      ? policy.tdd.minimumTests
      : hotfixLike || input.complexity === "COMPLEXA"
        ? 1
        : 2,
    approvedScenarios: tasks,
    batches,
  };
}

export function createQualityGateRouter() {
  return {
    planBatches(input: {
      complexity: PipelineComplexity;
      tasks: string[];
      mode?: string;
      validationIntent?: ValidationIntent;
    }): PlannedExecution {
      return planQualityGateBatches(input);
    },
  };
}
