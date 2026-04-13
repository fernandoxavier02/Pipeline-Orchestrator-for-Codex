import { resolveContinueResumeState } from "../controller/continue-state.js";
export async function resumePipeline(input) {
    return resolveContinueResumeState({
        session: {
            currentPhase: input.session.currentPhase,
        },
        checkpoints: input.checkpoints,
    });
}
