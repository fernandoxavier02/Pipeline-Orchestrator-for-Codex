import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentRuntimeAdapter } from "../dispatcher/dispatcher-types.js";

type RuntimeAdapterModule = {
  agentRuntime?: unknown;
  createAgentRuntime?: () => unknown | Promise<unknown>;
  default?: unknown;
};

function assertAgentRuntime(candidate: unknown): AgentRuntimeAdapter {
  if (
    !candidate
    || typeof candidate !== "object"
    || typeof (candidate as { spawnAgent?: unknown }).spawnAgent !== "function"
  ) {
    throw new Error(
      "blocked-no-agent-runtime: agent runtime adapter must expose a spawnAgent function.",
    );
  }

  return candidate as AgentRuntimeAdapter;
}

export async function loadAgentRuntimeAdapter(adapterPath?: string): Promise<AgentRuntimeAdapter | undefined> {
  if (!adapterPath) {
    return undefined;
  }

  const resolvedPath = isAbsolute(adapterPath) ? adapterPath : resolve(process.cwd(), adapterPath);
  const loaded = await import(pathToFileURL(resolvedPath).href) as RuntimeAdapterModule;
  const candidate = loaded.agentRuntime
    ?? (typeof loaded.createAgentRuntime === "function" ? await loaded.createAgentRuntime() : undefined)
    ?? loaded.default;

  return assertAgentRuntime(candidate);
}
