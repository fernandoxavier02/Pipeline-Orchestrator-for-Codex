import { createExecutorController } from "./executor-controller.js";
export async function runBatch(input) {
    const controller = createExecutorController();
    return controller.executeApprovedWork(input);
}
