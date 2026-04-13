import { resolveContinueResumeState } from "../controller/continue-state.js";

export async function resumePipeline(input: {
  session: {
    currentPhase: string;
    [key: string]: unknown;
  };
  checkpoints: Array<{ name: string; status: string }>;
}) {
  return resolveContinueResumeState({
    session: {
      currentPhase: input.session.currentPhase,
    },
    checkpoints: input.checkpoints,
  });
}
