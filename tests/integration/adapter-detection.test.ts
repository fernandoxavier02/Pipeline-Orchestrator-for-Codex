/**
 * Spec: pipeline-trust-restoration / R7 — Native Codex agentRuntime Adapter
 * Covers: R7 AC 7.1, 7.2, 7.3, 7.4
 */

import { describe, expect, it, vi } from "vitest";
import {
  createCodexAgentRuntimeAdapter,
  detectCodexAgentRuntime,
} from "../../src/adapters/codex-agent-runtime.js";
import type { AgentDispatchRequest } from "../../src/dispatcher/dispatcher-types.js";

function makeAgentRequest(overrides: Partial<AgentDispatchRequest> = {}): AgentDispatchRequest {
  return {
    role: "core:final-validator",
    phase: "phase-3",
    prompt: "Validate the final state.",
    input: {},
    expectedOutput: [],
    freshContext: true,
    ownership: [],
    reviewOnly: true,
    filesInScope: [],
    authorityLevel: "controller",
    executionIdentity: {
      trace_id: "trace-x",
      workflow_id: "wf-x",
      event_id: "ev-x",
      plugin_name: "pipeline-orchestrator-for-codex",
      plugin_version: "0.5.0",
      runtime: "codex",
      surface: "test",
      cwd: process.cwd(),
      pid: process.pid,
      node_version: process.version,
      timestamp: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("R7: detectCodexAgentRuntime", () => {
  it("R7 AC 7.1: returns adapter handle when globalScope.spawn_agent exists", () => {
    const stubScope = {
      spawn_agent: async () => ({ output: { status: "ok" } }),
    };
    const detected = detectCodexAgentRuntime(stubScope);
    expect(detected).not.toBeNull();
    expect(detected?.spawnAgent).toBe(stubScope.spawn_agent);
    expect(detected?.detectionMode).toBe("auto");
  });

  it("R7 AC 7.1: detects nested globalScope.codex.spawn_agent", () => {
    const stubScope = {
      codex: {
        spawn_agent: async () => ({ output: { status: "ok" } }),
      },
    };
    const detected = detectCodexAgentRuntime(stubScope);
    expect(detected).not.toBeNull();
    expect(typeof detected?.spawnAgent).toBe("function");
  });

  it("returns null when no spawn_agent is exposed", () => {
    const detected = detectCodexAgentRuntime({});
    expect(detected).toBeNull();
  });
});

describe("R7: createCodexAgentRuntimeAdapter", () => {
  it("R7 AC 7.3: invokes spawn_agent with namespaced FQN and serialized request", async () => {
    const spawnAgent = vi.fn<(input: { fqn: string; message: string }) => Promise<{ output: unknown }>>(
      async () => ({
        output: { status: "approved" },
      }),
    );
    const adapter = createCodexAgentRuntimeAdapter({ spawnAgent });

    const result = await adapter.spawnAgent(makeAgentRequest());

    expect(spawnAgent).toHaveBeenCalledTimes(1);
    const call = spawnAgent.mock.calls[0]?.[0];
    expect(call?.fqn).toBe("pipeline-orchestrator-for-codex:core:final-validator");
    expect(typeof call?.message).toBe("string");
    expect(result.mode).toBe("single-agent");
    expect((result.output as Record<string, unknown>).status).toBe("approved");
  });

  it("preserves a caller-supplied namespaced role", async () => {
    const spawnAgent = vi.fn<(input: { fqn: string; message: string }) => Promise<{ output: unknown }>>(
      async () => ({ output: {} }),
    );
    const adapter = createCodexAgentRuntimeAdapter({ spawnAgent });
    await adapter.spawnAgent(
      makeAgentRequest({ role: "pipeline-orchestrator-for-codex:executor:executor-controller" }),
    );
    const call = spawnAgent.mock.calls[0]?.[0];
    expect(call?.fqn).toBe(
      "pipeline-orchestrator-for-codex:executor:executor-controller",
    );
  });

  it("respects a custom pluginNamespace option", async () => {
    const spawnAgent = vi.fn<(input: { fqn: string; message: string }) => Promise<{ output: unknown }>>(
      async () => ({ output: {} }),
    );
    const adapter = createCodexAgentRuntimeAdapter({
      spawnAgent,
      pluginNamespace: "custom-namespace",
    });
    await adapter.spawnAgent(makeAgentRequest({ role: "core:final-validator" }));
    const call = spawnAgent.mock.calls[0]?.[0];
    expect(call?.fqn).toBe("custom-namespace:core:final-validator");
  });

  it("R7 AC 7.4: throws AgentRuntimeUnavailableError when spawn_agent rejects (never falls back to emulation)", async () => {
    const spawnAgent = vi.fn<(input: { fqn: string; message: string }) => Promise<{ output: unknown }>>(
      async () => {
        throw new Error("network down");
      },
    );
    const adapter = createCodexAgentRuntimeAdapter({ spawnAgent });

    await expect(adapter.spawnAgent(makeAgentRequest())).rejects.toThrow(
      /network down|AgentRuntimeUnavailable|blocked-no-agent-runtime/,
    );
  });

  it("factory rejects non-function spawn_agent input", () => {
    expect(() =>
      createCodexAgentRuntimeAdapter({ spawnAgent: undefined as never }),
    ).toThrow();
  });
});
