import type { PipelineComplexity, ValidationIntent } from "../controller/classification-overrides.js";

export interface PlannedBatch {
  name: string;
  tasks: string[];
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
    batches.push({
      name: `batch-${batches.length + 1}`,
      tasks: tasks.slice(index, index + batchSize),
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
  const hotfixLike = input.mode === "--hotfix" || input.validationIntent === "reduced";
  const batchSize =
    hotfixLike || input.complexity === "COMPLEXA"
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
          },
        ]
      : chunkTasks(tasks, batchSize);

  return {
    batchSize,
    regressionProofs: hotfixLike || input.complexity === "COMPLEXA" ? 1 : 2,
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
