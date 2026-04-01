export async function resumePipeline(input: {
  session: {
    currentPhase: string;
    [key: string]: unknown;
  };
  checkpoints: Array<{ name: string; status: string }>;
}) {
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
