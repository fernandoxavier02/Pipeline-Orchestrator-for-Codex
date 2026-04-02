import type { DispatchRequest } from "./dispatcher-types.js";
import { runSingleAgentRole } from "./single-agent-runner.js";

export async function runRole(request: DispatchRequest) {
  const normalizedRequest: DispatchRequest = {
    ...request,
    freshContext: request.freshContext ?? request.role.includes("review"),
    reviewOnly: request.reviewOnly ?? false,
  };

  if (request.mode === "multi-agent") {
    throw new Error("Multi-agent mode is not implemented yet");
  }

  return runSingleAgentRole(normalizedRequest);
}
