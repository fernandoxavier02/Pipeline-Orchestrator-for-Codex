import { runParallelEmulation } from "./parallel-emulation-runner.js";
import { runSingleAgentRole } from "./single-agent-runner.js";
import { ensureWriteAuthorized } from "../security/edit-guard.js";
import { scanObjectForPromptInjection } from "../security/prompt-injection-guard.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { probeCodexMultiAgent } from "./codex-host-probe.js";
export { EditGuardBlockedError } from "../security/edit-guard.js";
export class AgentRuntimeUnavailableError extends Error {
    code = "blocked-no-agent-runtime";
    dispatchMode = "blocked-no-agent-runtime";
    constructor(role, hostStatus) {
        const hostHint = hostStatus ? ` (${hostStatus})` : "";
        super(`blocked-no-agent-runtime: real agent runtime is required for role "${role}", but no spawn_agent adapter is available.${hostHint}`);
        this.name = "AgentRuntimeUnavailableError";
    }
}
function buildAgentDispatchRequest(request) {
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
function withExecutionIdentity(result, executionIdentity) {
    return {
        mode: "mode" in result && result.mode === "parallel-emulation" ? "parallel-emulation" : "single-agent",
        role: "role" in result && typeof result.role === "string" ? result.role : "unknown-role",
        executionIdentity,
        output: {
            ...result.output,
            executionIdentity,
        },
    };
}
function validateAgentRuntime(agentRuntime) {
    if (!agentRuntime ||
        typeof agentRuntime !== "object" ||
        typeof agentRuntime.spawnAgent !== "function") {
        throw new Error("blocked-no-agent-runtime: agentRuntime must be an object with a spawnAgent function.");
    }
}
export async function runRole(request) {
    const normalizedRequest = {
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
    const requestWithIdentity = {
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
    // Scan request.input, request.prompt, and team members for prompt injection payloads before dispatch
    if (normalizedRequest.input) {
        scanObjectForPromptInjection(normalizedRequest.input, `dispatch:${normalizedRequest.role}:input`);
    }
    if (normalizedRequest.prompt) {
        scanObjectForPromptInjection({ prompt: normalizedRequest.prompt }, `dispatch:${normalizedRequest.role}:prompt`);
    }
    if (normalizedRequest.team) {
        for (let i = 0; i < normalizedRequest.team.length; i += 1) {
            const member = normalizedRequest.team[i];
            if (member.input) {
                scanObjectForPromptInjection(member.input, `dispatch:${normalizedRequest.role}:team[${i}]:input`);
            }
            if (member.prompt) {
                scanObjectForPromptInjection({ prompt: member.prompt }, `dispatch:${normalizedRequest.role}:team[${i}]:prompt`);
            }
        }
    }
    if (normalizedRequest.requireRealAgent) {
        if (!normalizedRequest.agentRuntime) {
            const hostMultiAgent = await probeCodexMultiAgent();
            const hostStatus = hostMultiAgent === true
                ? "Codex host has multi_agent=true, but no agentRuntime was injected"
                : hostMultiAgent === false
                    ? "Codex host has multi_agent=false in ~/.codex/config.toml"
                    : "Could not read ~/.codex/config.toml to verify multi_agent status";
            throw new AgentRuntimeUnavailableError(normalizedRequest.role, hostStatus);
        }
        validateAgentRuntime(normalizedRequest.agentRuntime);
        const result = await normalizedRequest.agentRuntime.spawnAgent(buildAgentDispatchRequest(requestWithIdentity));
        return withExecutionIdentity({
            ...result,
            output: {
                ...result.output,
                dispatchMode: "real-agent",
            },
        }, executionIdentity);
    }
    if (request.mode === "parallel-emulation") {
        const result = await runParallelEmulation(requestWithIdentity);
        return withExecutionIdentity(result, executionIdentity);
    }
    const result = await runSingleAgentRole(requestWithIdentity);
    return withExecutionIdentity(result, executionIdentity);
}
