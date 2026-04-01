import { PIPELINE_MODES, type RuntimeOptions } from "./domain/pipeline-types.js";

export function createPipelineRuntime(options: RuntimeOptions) {
  return {
    controller: {},
    stateDir: `${options.cwd}/.codex/pipeline`,
    supportedModes: [...PIPELINE_MODES],
  };
}
