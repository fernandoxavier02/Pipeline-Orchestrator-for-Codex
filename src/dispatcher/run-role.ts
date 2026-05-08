import type { AgentDispatchMode, AgentDispatchRequest, DispatchRequest, RunRoleResult } from "./dispatcher-types.js";
import { runMultiAgentRole } from "./multi-agent-runner.js";
import { runSingleAgentRole } from "./single-agent-runner.js";
import { ensureWriteAuthorized } from "../security/edit-guard.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";

export { EditGuardBlockedError } from "../security/edit-guard.js";

export class AgentRuntimeUnavailableError extends Error {
  readonly code = "blocked-no-agent-runtime";
  readonly dispatchMode: AgentDispatchMode = "blocked-no-agent-runtime";

  constructor(role: string) {
    super(`blocked-no-agent-runtime: real agent runtime is required for role "${role}", but no spawn_agent adapter is available.`);
    this.name = "AgentRuntimeUnavailableError";
  }
}

type DispatchRequestWithIdentity = DispatchRequest & {
  executionIdentity: ReturnType<typeof createExecutionIdentity>;
};

function buildAgentDispatchRequest(request: DispatchRequestWithIdentity): AgentDispatchRequest {
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
    executionIdentity: request.executionIdentity,
  };
}

function withExecutionIdentity<T extends { output: Record<string, unknown> }>(
  result: T,
  executionIdentity: ReturnType<typeof createExecutionIdentity>,
): RunRoleResult {
  return {
    mode: "mode" in result && (result as { mode?: unknown }).mode === "multi-agent" ? "multi-agent" : "single-agent",
    role: "role" in result && typeof (result as { role?: unknown }).role === "string" ? (result as { role: string }).role : "unknown-role",
    executionIdentity,
    output: {
      ...result.output,
      executionIdentity,
    },
  };
}

export async function runRole(request: DispatchRequest): Promise<RunRoleResult> {
  const normalizedRequest: DispatchRequest = {
    ...request,
    freshContext: request.freshContext ?? request.role.includes("review"),
    reviewOnly: request.reviewOnly ?? false,
  };
  const executionIdentity = normalizedRequest.executionIdentity ?? createExecutionIdentity({
    surface: `dispatch:${normalizedRequest.role}`,
    sessionId: normalizedRequest.sessionId,
    stateRoot: normalizedRequest.sessionRoot,
    source: normalizedRequest.requireRealAgent ? "real-agent-dispatch" : normalizedRequest.mode,
  });
  const requestWithIdentity: DispatchRequestWithIdentity = {
    ...normalizedRequest,
    executionIdentity,
  };

  // B2: edit-guard middleware. Throws EditGuardBlockedError when a
  // write-capable role is dispatched without an OPEN exec-window.
  // Disabled when sessionRoot/sessionId are omitted (legacy callers).
  ensureWriteAuthorized({
    role: normalizedRequest.role,
    sessionRoot: normalizedRequest.sessionRoot,
    sessionId: normalizedRequest.sessionId,
  });

  if (normalizedRequest.requireRealAgent) {
    if (!normalizedRequest.agentRuntime) {
      throw new AgentRuntimeUnavailableError(normalizedRequest.role);
    }

    const result = await normalizedRequest.agentRuntime.spawnAgent(buildAgentDispatchRequest(requestWithIdentity));
    return withExecutionIdentity({
      ...result,
      output: {
        ...result.output,
        dispatchMode: "real-agent",
      },
    }, executionIdentity);
  }

  if (request.mode === "multi-agent") {
    const result = await runMultiAgentRole(requestWithIdentity);
    return withExecutionIdentity(result, executionIdentity);
  }

  const result = await runSingleAgentRole(requestWithIdentity);
  return withExecutionIdentity(result, executionIdentity);
}
