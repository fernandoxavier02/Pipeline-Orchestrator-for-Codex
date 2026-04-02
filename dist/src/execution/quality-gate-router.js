function chunkTasks(tasks, batchSize) {
    const batches = [];
    for (let index = 0; index < tasks.length; index += batchSize) {
        batches.push({
            name: `batch-${batches.length + 1}`,
            tasks: tasks.slice(index, index + batchSize),
        });
    }
    return batches;
}
export function createQualityGateRouter() {
    return {
        planBatches(input) {
            const tasks = [...input.tasks];
            const hotfixLike = input.mode === "--hotfix" || input.validationIntent === "reduced";
            const batchSize = hotfixLike || input.complexity === "COMPLEXA"
                ? 1
                : input.complexity === "MEDIA"
                    ? 3
                    : Math.max(1, tasks.length);
            const batches = input.complexity === "SIMPLES"
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
        },
    };
}
