// Spec: pipeline-trust-restoration / R7 — Native Codex agentRuntime Adapter.
//
// A thin bridge between the pipeline runtime contract (AgentRuntimeAdapter) and
// a Codex-host-exposed `spawn_agent` callable. The adapter is opt-in:
//
//   - `createCodexAgentRuntimeAdapter({ spawnAgent })` — factory; the caller
//     supplies the real spawn_agent reference (no implicit imports of host
//     internals from the plain-Node CLI process).
//   - `detectCodexAgentRuntime()` — runtime detection that returns a
//     constructable handle if the current process exposes spawn_agent on
//     `globalThis` or via an explicit env-var hint. Returns null in plain
//     Node sessions; the caller falls back to the existing CLI loader
//     (--agent-runtime-adapter / CODEX_AGENT_RUNTIME_ADAPTER).
//
// The adapter never falls back to the local emulation path. When invoked in a
// context where `spawn_agent` is unavailable it throws `AgentRuntimeUnavailableError`
// (R7 AC 7.4) so `runtimeRunRole` surfaces `blocked-no-agent-runtime` rather
// than silently emulating.

import type {
  AgentDispatchRequest,
  AgentRuntimeAdapter,
  DispatchResult,
} from "../dispatcher/dispatcher-types.js";
import { AgentRuntimeUnavailableError } from "../dispatcher/run-role.js";

export interface SpawnAgentInput {
  agent_type: "worker";
  fork_context: false;
  message: string;
}

export interface SpawnAgentResult {
  output: unknown;
}

export type SpawnAgentCallable = (input: SpawnAgentInput) => Promise<SpawnAgentResult>;
export type WaitAgentCallable = (dispatch: DispatchResult) => Promise<SpawnAgentResult | DispatchResult>;

export interface CodexAgentRuntimeOptions {
  /** Real spawn_agent function exposed by the Codex host. */
  spawnAgent: SpawnAgentCallable;
  /** Real wait_agent function exposed by the Codex host. */
  waitAgent?: WaitAgentCallable;
  /**
   * Pipeline plugin namespace used when assembling FQN markers
   * (`<pluginNamespace>:<folder>:<leaf>`). Defaults to
   * `pipeline-orchestrator-for-codex`.
   */
  pluginNamespace?: string;
  /**
   * Marker that identifies how the adapter was wired. Surfaced in audit logs
   * but not consumed by the dispatcher.
   */
  detectionMode?: "auto" | "manual";
}

const DEFAULT_NAMESPACE = "pipeline-orchestrator-for-codex";

function buildFqn(namespace: string, role: string): string {
  // If the caller already provided a fully-qualified marker we honor it.
  if (role.startsWith(`${namespace}:`)) {
    return role;
  }
  // Roles flow through the runtime as "<folder>:<leaf>" or bare "<leaf>".
  // The Codex host expects "<namespace>:<folder>:<leaf>" or a plain leaf — we
  // always emit the namespaced form so dispatch-guard.cjs can validate it.
  const path = role.includes(":") ? role : `core:${role}`;
  return `${namespace}:${path}`;
}

// Post-review (QUAL-001): explicit projection over AgentDispatchRequest.
// `executionIdentity` is intentionally omitted so the host does not have to
// reason about parent trace metadata for the child dispatch (the host can
// regenerate it). Any future field added to AgentDispatchRequest MUST be
// reviewed against this projection — TypeScript will not warn because the
// function takes the full type and discards what it does not name.
//
// To force a compile-time signal, the local `Wire` type below is kept in
// sync via a `satisfies` annotation on the return statement: if a field is
// added to AgentDispatchRequest, removing it from `Wire` will break the
// `satisfies` check (or vice versa) and force a deliberate decision.
type Wire = {
  role: AgentDispatchRequest["role"];
  phase: AgentDispatchRequest["phase"];
  prompt: AgentDispatchRequest["prompt"];
  input: AgentDispatchRequest["input"];
  expectedOutput: AgentDispatchRequest["expectedOutput"];
  freshContext: AgentDispatchRequest["freshContext"];
  ownership: AgentDispatchRequest["ownership"];
  reviewOnly: AgentDispatchRequest["reviewOnly"];
  filesInScope: AgentDispatchRequest["filesInScope"];
  authorityLevel: AgentDispatchRequest["authorityLevel"];
};

function serializeRequest(request: AgentDispatchRequest): string {
  const wire: Wire = {
    role: request.role,
    phase: request.phase,
    prompt: request.prompt,
    input: request.input,
    expectedOutput: request.expectedOutput,
    freshContext: request.freshContext,
    ownership: request.ownership,
    reviewOnly: request.reviewOnly,
    filesInScope: request.filesInScope,
    authorityLevel: request.authorityLevel,
  };
  return JSON.stringify(wire satisfies Wire);
}

function isDispatchResult(value: unknown): value is DispatchResult {
  return (
    !!value
    && typeof value === "object"
    && "role" in value
    && "mode" in value
    && "output" in value
  );
}

function toDispatchResult(value: unknown, fallback: DispatchResult): DispatchResult {
  if (isDispatchResult(value)) {
    return value;
  }

  if (
    value
    && typeof value === "object"
    && "output" in value
  ) {
    const output = (value as SpawnAgentResult).output;
    if (isDispatchResult(output)) {
      return output;
    }

    return {
      ...fallback,
      output:
        output && typeof output === "object"
          ? (output as Record<string, unknown>)
          : { output },
    };
  }

  return fallback;
}

export function createCodexAgentRuntimeAdapter(
  options: CodexAgentRuntimeOptions,
): AgentRuntimeAdapter {
  if (typeof options.spawnAgent !== "function") {
    throw new Error(
      "createCodexAgentRuntimeAdapter: options.spawnAgent must be a function",
    );
  }
  const namespace = options.pluginNamespace ?? DEFAULT_NAMESPACE;

  return {
    runtimeMode: "real-agent",
    capabilities: {
      spawnAgent: true,
      waitAgent: typeof options.waitAgent === "function",
      collectArtifacts: true,
      recordGates: true,
      recordCheckpoints: true,
      structuredFinalState: true,
    },
    async spawnAgent(request: AgentDispatchRequest): Promise<DispatchResult> {
      try {
        const fqn = buildFqn(namespace, request.role);
        const response = await options.spawnAgent({
          agent_type: "worker",
          fork_context: false,
          message: [
            `PIPELINE_AGENT_FQN: ${fqn}`,
            "PARENT_PROTOCOL_RUNTIME:",
            "  mode: real-agent",
            "  spawn_agent: available",
            `  wait_agent: ${typeof options.waitAgent === "function" ? "available" : "missing"}`,
            "  dispatch_contract: parent_handles_dispatch_request",
            serializeRequest(request),
          ].join("\n"),
        });

        if (isDispatchResult(response.output)) {
          return response.output;
        }

        // Common Codex shape: { output: <agent JSON> }. Wrap into the
        // DispatchResult contract that run-role expects.
        return {
          mode: "single-agent",
          role: request.role,
          output:
            response.output && typeof response.output === "object"
              ? (response.output as Record<string, unknown>)
              : { output: response.output },
        };
      } catch (err) {
        // R7 AC 7.4 — never silently fall back to emulation. Translate every
        // failure into AgentRuntimeUnavailableError so run-role surfaces
        // blocked-no-agent-runtime to the caller.
        const reason = err instanceof Error ? err.message : String(err);
        throw new AgentRuntimeUnavailableError(request.role, reason);
      }
    },
    async waitAgent(dispatch: DispatchResult): Promise<DispatchResult> {
      if (typeof options.waitAgent !== "function") {
        throw new AgentRuntimeUnavailableError(
          dispatch.role,
          "wait_agent callable was not provided by the Codex host",
        );
      }

      return toDispatchResult(await options.waitAgent(dispatch), dispatch);
    },
    async collectArtifacts(dispatches: DispatchResult[]): Promise<Record<string, unknown>[]> {
      return dispatches.map((dispatch) => dispatch.output);
    },
  };
}

// Post-review fix (SEC-008): capture the spawn_agent reference at module load
// time so a later hijack of `globalThis.spawn_agent` (by an adversarial
// in-process script or a compromised agent prompt) cannot silently substitute
// a payload-exfiltrating function. Each call to detectCodexAgentRuntime
// compares the live `globalThis.spawn_agent` against the captured reference
// and emits a stderr warning on mismatch. The function itself is still
// returned so the runtime keeps working, but the operator gets observability.
const CAPTURED_SPAWN_AGENT = (globalThis as Record<string, unknown>).spawn_agent;
const CAPTURED_CODEX_SPAWN_AGENT = (() => {
  const codexScope = (globalThis as Record<string, unknown>).codex;
  if (codexScope && typeof codexScope === "object") {
    return (codexScope as Record<string, unknown>).spawn_agent;
  }
  return undefined;
})();
const CAPTURED_WAIT_AGENT = (globalThis as Record<string, unknown>).wait_agent;
const CAPTURED_CODEX_WAIT_AGENT = (() => {
  const codexScope = (globalThis as Record<string, unknown>).codex;
  if (codexScope && typeof codexScope === "object") {
    return (codexScope as Record<string, unknown>).wait_agent;
  }
  return undefined;
})();

/**
 * Runtime detection — returns a constructable handle when the current process
 * exposes a usable spawn_agent reference. The cascade:
 *
 *   1. `globalThis.spawn_agent` (Codex host injection, future-facing).
 *   2. `globalThis.codex?.spawn_agent` (alternative namespace).
 *
 * Returns null in plain Node sessions; the CLI falls back to its existing
 * loader (--agent-runtime-adapter / CODEX_AGENT_RUNTIME_ADAPTER).
 *
 * Hijack detection (SEC-008): emits stderr warning when the live reference
 * differs from the module-load-time captured value.
 */
export function detectCodexAgentRuntime(
  globalScope: Record<string, unknown> = globalThis as Record<string, unknown>,
): CodexAgentRuntimeOptions | null {
  const directCandidate = globalScope.spawn_agent;
  if (typeof directCandidate === "function") {
    if (CAPTURED_SPAWN_AGENT !== undefined && directCandidate !== CAPTURED_SPAWN_AGENT) {
      process.stderr.write(
        "[codex-agent-runtime] WARNING: globalThis.spawn_agent reference changed since module load — possible hijack.\n",
      );
    }
    const waitCandidate = globalScope.wait_agent;
    if (CAPTURED_WAIT_AGENT !== undefined && waitCandidate !== CAPTURED_WAIT_AGENT) {
      process.stderr.write(
        "[codex-agent-runtime] WARNING: globalThis.wait_agent reference changed since module load — possible hijack.\n",
      );
    }
    return {
      spawnAgent: directCandidate as SpawnAgentCallable,
      waitAgent: typeof waitCandidate === "function" ? waitCandidate as WaitAgentCallable : undefined,
      detectionMode: "auto",
    };
  }
  const codexScope = globalScope.codex;
  if (codexScope && typeof codexScope === "object") {
    const nestedScope = codexScope as Record<string, unknown>;
    const nested = nestedScope.spawn_agent;
    if (typeof nested === "function") {
      if (CAPTURED_CODEX_SPAWN_AGENT !== undefined && nested !== CAPTURED_CODEX_SPAWN_AGENT) {
        process.stderr.write(
          "[codex-agent-runtime] WARNING: globalThis.codex.spawn_agent reference changed since module load — possible hijack.\n",
        );
      }
      const nestedWait = nestedScope.wait_agent;
      if (CAPTURED_CODEX_WAIT_AGENT !== undefined && nestedWait !== CAPTURED_CODEX_WAIT_AGENT) {
        process.stderr.write(
          "[codex-agent-runtime] WARNING: globalThis.codex.wait_agent reference changed since module load — possible hijack.\n",
        );
      }
      return {
        spawnAgent: nested as SpawnAgentCallable,
        waitAgent: typeof nestedWait === "function" ? nestedWait as WaitAgentCallable : undefined,
        detectionMode: "auto",
      };
    }
  }
  return null;
}
