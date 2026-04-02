import { createPipelineController } from "./controller/pipeline-controller.js";
import { runRole } from "./dispatcher/run-role.js";
import { PIPELINE_MODES, type RuntimeOptions } from "./domain/pipeline-types.js";
import { loadReferenceBundle } from "./references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "./references/reference-profiles.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";

export function createPipelineRuntime(options: RuntimeOptions) {
  const stateDir = `${options.cwd}/.codex/pipeline`;
  const sessionStore = createSessionStore(stateDir);
  const checkpointStore = createCheckpointStore(stateDir);
  const gateLogStore = createGateLog(stateDir);
  const confidenceStore = createConfidenceScoreStore(stateDir);
  const controllerStores = {
    session: sessionStore,
    checkpoints: checkpointStore,
    gateLog: gateLogStore,
    confidence: confidenceStore,
  };
  const publicStores = {
    session: sessionStore,
    checkpoints: checkpointStore,
  };
  const getReferenceIndex = (() => {
    let referenceIndexPromise: Promise<ReturnType<typeof createReferenceProfileIndex>> | undefined;

    return () => {
      referenceIndexPromise ??= loadReferenceBundle(options.cwd).then(createReferenceProfileIndex);
      return referenceIndexPromise;
    };
  })();

  return {
    controller: createPipelineController({
      workspaceRoot: options.cwd,
      stores: controllerStores,
      referenceIndex: getReferenceIndex,
    }),
    dispatcher: { runRole },
    stateDir,
    supportedModes: [...PIPELINE_MODES],
    referenceIndex: getReferenceIndex,
    stores: publicStores,
  };
}
