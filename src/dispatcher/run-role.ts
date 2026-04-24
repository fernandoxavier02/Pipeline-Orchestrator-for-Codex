import type { AgentDispatchMode, AgentDispatchRequest, DispatchRequest } from "./dispatcher-types.js";
import { runMultiAgentRole } from "./multi-agent-runner.js";
import { runSingleAgentRole } from "./single-agent-runner.js";

export class AgentRuntimeUnavailableError extends Error {
  readonly code = "blocked-no-agent-runtime";
  readonly dispatchMode: AgentDispatchMode = "blocked-no-agent-runtime";

  constructor(role: string) {
    super(`blocked-no-agent-runtime: real agent runtime is required for role "${role}", but no spawn_agent adapter is available.`);
    this.name = "AgentRuntimeUnavailableError";
  }
}

function buildAgentDispatchRequest(request: DispatchRequest): AgentDispatchRequest {
  return {
    role: request.role,
    phase: request.phase ?? "phase-2",
    prompt: request.prompt,
    input: request.input,
    expectedOutput: request.expectedOutput ?? [],
    freshContext: request.freshContext ?? request.role.includes("review"),
    ownership: request.ownership ?? request.filesInScope ?? [],
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? [],
    authorityLevel: request.authorityLevel ?? "reviewer",
  };
}

export async function runRole(request: DispatchRequest) {
  const normalizedRequest: DispatchRequest = {
    ...request,
    freshContext: request.freshContext ?? request.role.includes("review"),
    reviewOnly: request.reviewOnly ?? false,
  };

  if (normalizedRequest.requireRealAgent) {
    if (!normalizedRequest.agentRuntime) {
      throw new AgentRuntimeUnavailableError(normalizedRequest.role);
    }

    const result = await normalizedRequest.agentRuntime.spawnAgent(buildAgentDispatchRequest(normalizedRequest));
    return {
      ...result,
      output: {
        ...result.output,
        dispatchMode: "real-agent",
      },
    };
  }

  if (request.mode === "multi-agent") {
    return runMultiAgentRole(normalizedRequest);
  }

  return runSingleAgentRole(normalizedRequest);
}
