import { createPipelineController } from "./controller/pipeline-controller.js";
import { PIPELINE_MODES, type RuntimeOptions } from "./domain/pipeline-types.js";

export function createPipelineRuntime(options: RuntimeOptions) {
  return {
    controller: createPipelineController(),
    stateDir: `${options.cwd}/.codex/pipeline`,
    supportedModes: [...PIPELINE_MODES],
  };
}
