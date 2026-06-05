#!/usr/bin/env node
/**
 * CLI entrypoint for pipeline execution in Kimi Code CLI and other environments.
 *
 * Usage:
 *   node dist/src/cli/pipeline-cli.js "<task description>"
 *   node dist/src/cli/pipeline-cli.js --mode=diagnostic "<task>"
 *   node dist/src/cli/pipeline-cli.js --continue
 */
import { createPipelineRuntime } from "../index.js";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { loadAgentRuntimeAdapter } from "./agent-runtime-loader.js";
export function resolveCliExitCode(result) {
    if (!result || typeof result !== "object") {
        return 1;
    }
    const status = result.status;
    if (typeof status === "string" && status.toLowerCase().startsWith("blocked")) {
        return 1;
    }
    if (result.ok === false) {
        return 1;
    }
    return 0;
}
function parseArgs(argv) {
    const args = argv.slice(2);
    const options = {
        cwd: process.cwd(),
        codexHome: process.env.CODEX_HOME || process.cwd(),
    };
    let taskParts = [];
    for (const arg of args) {
        if (arg === "--continue") {
            options.continue = true;
        }
        else if (arg.startsWith("--mode=")) {
            options.mode = arg.slice("--mode=".length);
        }
        else if (arg.startsWith("--strict-agents")) {
            options.strictAgents = true;
        }
        else if (arg.startsWith("--agent-runtime-adapter=")) {
            options.agentRuntimeAdapter = arg.slice("--agent-runtime-adapter=".length);
        }
        else if (arg.startsWith("--cwd=")) {
            options.cwd = arg.slice("--cwd=".length);
        }
        else if (!arg.startsWith("-")) {
            taskParts.push(arg);
        }
    }
    options.task = taskParts.join(" ").trim() || undefined;
    return options;
}
export async function runPipelineCli(options) {
    const agentRuntime = options.agentRuntime
        ?? await loadAgentRuntimeAdapter(options.agentRuntimeAdapter ?? process.env.CODEX_AGENT_RUNTIME_ADAPTER);
    // R6 AC 6.2 — on continue, if the caller did not pass --strict-agents,
    // honor the value persisted in the latest session.json. Legacy sessions
    // (no field) keep strictAgents as undefined and the cascade applies fresh.
    let effectiveStrictAgents = options.strictAgents;
    if (options.continue && effectiveStrictAgents === undefined) {
        try {
            const { findLatestRun } = await import("../continue/find-latest-run.js");
            const { loadPersistedStrictAgents } = await import("../state/session-store.js");
            const stateDir = join(options.cwd ?? process.cwd(), ".codex", "pipeline");
            const latestRun = await findLatestRun(stateDir);
            if (latestRun?.runDir) {
                effectiveStrictAgents = await loadPersistedStrictAgents(latestRun.runDir);
            }
        }
        catch {
            // peek is best-effort; fall back to undefined (cascade default applies).
        }
    }
    effectiveStrictAgents ??= true;
    const runtime = createPipelineRuntime({
        cwd: options.cwd,
        codexHome: options.codexHome,
        strictAgents: effectiveStrictAgents,
        agentRuntime,
    });
    const input = options.continue
        ? "/pipeline-orchestrator-for-codex:pipeline continue"
        : options.mode
            ? `/pipeline-orchestrator-for-codex:pipeline ${options.mode} ${options.task}`
            : `/pipeline-orchestrator-for-codex:pipeline ${options.task}`;
    return runtime.controller.start(input);
}
async function main() {
    const options = parseArgs(process.argv);
    if (!options.task && !options.continue) {
        console.error("Usage: pipeline-cli <task> [--mode=MODE] [--strict-agents] [--agent-runtime-adapter=PATH] [--continue]");
        console.error("Modes: full, diagnostic, continue, review-only, --simples, --media, --complexa, --hotfix, --grill, --plan");
        process.exit(1);
    }
    try {
        const result = await runPipelineCli(options);
        console.log(JSON.stringify(result, null, 2));
        process.exit(resolveCliExitCode(result));
    }
    catch (error) {
        console.error("Pipeline execution failed:", error);
        process.exit(1);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
