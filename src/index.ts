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
  const stores = {
    session: createSessionStore(stateDir),
    checkpoints: createCheckpointStore(stateDir),
    gateLog: createGateLog(stateDir),
    confidence: createConfidenceScoreStore(stateDir),
  };
  const getReferenceIndex = (() => {
    let referenceIndexPromise: Promise<ReturnType<typeof createReferenceProfileIndex>> | undefined;

    return () => {
      referenceIndexPromise ??= loadReferenceBundle(options.cwd).then(createReferenceProfileIndex);
      return referenceIndexPromise;
    };
  })();

  return {
    controller: createPipelineController({ stores, referenceIndex: getReferenceIndex }),
    dispatcher: { runRole },
    stateDir,
    supportedModes: [...PIPELINE_MODES],
    referenceIndex: getReferenceIndex,
    stores,
  };
}
