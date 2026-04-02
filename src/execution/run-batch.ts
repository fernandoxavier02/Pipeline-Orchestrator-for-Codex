import { createExecutorController, type ExecuteApprovedWorkInput } from "./executor-controller.js";

export async function runBatch(input: ExecuteApprovedWorkInput) {
  const controller = createExecutorController();
  return controller.executeApprovedWork(input);
}
