import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCodexCliProcessRuntime } from "../adapters/codex-cli-process-runtime.js";
function assertAgentRuntime(candidate) {
    if (!candidate
        || typeof candidate !== "object"
        || typeof candidate.spawnAgent !== "function") {
        throw new Error("blocked-no-agent-runtime: agent runtime adapter must expose a spawnAgent function.");
    }
    return candidate;
}
export async function loadAgentRuntimeAdapter(adapterPath) {
    if (!adapterPath) {
        return undefined;
    }
    if (adapterPath === "codex-cli" || adapterPath === "codex-cli-process") {
        return createCodexCliProcessRuntime();
    }
    if (adapterPath === "codex-cli-dev-bypass" || adapterPath === "codex-cli-process-dev-bypass") {
        return createCodexCliProcessRuntime({ allowDangerousBypass: true });
    }
    const resolvedPath = isAbsolute(adapterPath) ? adapterPath : resolve(process.cwd(), adapterPath);
    const loaded = await import(pathToFileURL(resolvedPath).href);
    const candidate = loaded.agentRuntime
        ?? (typeof loaded.createAgentRuntime === "function" ? await loaded.createAgentRuntime() : undefined)
        ?? loaded.default;
    return assertAgentRuntime(candidate);
}
