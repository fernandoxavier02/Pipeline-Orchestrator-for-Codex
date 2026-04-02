export function buildBatches(input) {
    const chunkSize = 2;
    const batches = [];
    for (let index = 0; index < input.files.length; index += chunkSize) {
        batches.push({
            name: `batch-${batches.length + 1}`,
            files: input.files.slice(index, index + chunkSize),
        });
    }
    return batches;
}
