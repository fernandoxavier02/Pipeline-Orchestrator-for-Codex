export async function resumePipeline(input) {
    const lastCompleted = [...input.checkpoints]
        .reverse()
        .find((entry) => entry.status === "completed");
    if (!lastCompleted) {
        throw new Error("No completed checkpoint available to resume");
    }
    return {
        resumeFrom: lastCompleted.name,
        nextPhase: input.session.currentPhase,
    };
}
