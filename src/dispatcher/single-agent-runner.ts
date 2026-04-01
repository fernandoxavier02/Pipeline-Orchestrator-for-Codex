import type { DispatchRequest, DispatchResult } from "./dispatcher-types.js";

export async function runSingleAgentRole(
  request: DispatchRequest,
): Promise<DispatchResult> {
  return {
    mode: "single-agent",
    role: request.role,
    output: {
      prompt: request.prompt,
      input: request.input,
    },
  };
}
