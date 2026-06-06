import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntimeUnavailableError } from "../dispatcher/run-role.js";
function buildPrompt(request) {
    return [
        `PIPELINE_AGENT_FQN: ${request.role}`,
        "",
        "You are a Codex CLI child worker for Pipeline Orchestrator.",
        "Return ONLY a single JSON object. Do not wrap it in markdown.",
        "The object must include: status, role, summary, evidence.",
        "",
        "REQUEST_JSON:",
        JSON.stringify(request, null, 2),
    ].join("\n");
}
function extractJsonObject(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { status: "blocked", summary: "codex child returned empty output", evidence: [] };
    }
    const direct = tryParseJson(trimmed);
    if (direct)
        return direct;
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
    if (fenced) {
        const parsed = tryParseJson(fenced[1].trim());
        if (parsed)
            return parsed;
    }
    return {
        status: "completed",
        summary: trimmed.slice(0, 4000),
        evidence: [trimmed.slice(0, 4000)],
    };
}
function tryParseJson(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
async function runCodexExec(prompt, options) {
    const tempRoot = await mkdtemp(join(tmpdir(), "pipeline-codex-agent-"));
    const promptPath = join(tempRoot, "prompt.md");
    const outputPath = join(tempRoot, "output.md");
    await writeFile(promptPath, prompt, "utf8");
    const args = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--dangerously-bypass-hook-trust",
        "-C",
        options.cwd,
        "-o",
        outputPath,
        ...(options.model ? ["-m", options.model] : []),
        ...(options.extraArgs ?? []),
        "-",
    ];
    try {
        await new Promise((resolve, reject) => {
            const child = spawn(options.codexBin, args, {
                cwd: options.cwd,
                stdio: ["pipe", "ignore", "pipe"],
            });
            let stderr = "";
            const timer = setTimeout(() => {
                child.kill("SIGTERM");
                reject(new Error(`codex exec timed out after ${options.timeoutMs}ms`));
            }, options.timeoutMs);
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString("utf8");
            });
            child.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`codex exec exited with ${code}: ${stderr.slice(0, 2000)}`));
                }
            });
            child.stdin.end(prompt);
        });
        const raw = await readFile(outputPath, "utf8").catch(() => "");
        return extractJsonObject(raw);
    }
    finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}
export function createCodexCliProcessRuntime(options = {}) {
    const codexBin = options.codexBin ?? process.env.CODEX_CLI_PATH ?? "codex";
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? 120_000;
    return {
        capabilities: {
            spawnAgent: true,
            waitAgent: true,
            collectArtifacts: true,
            recordGates: true,
            recordCheckpoints: true,
            structuredFinalState: true,
        },
        async spawnAgent(request) {
            try {
                const output = await runCodexExec(buildPrompt(request), {
                    codexBin,
                    cwd,
                    timeoutMs,
                    model: options.model,
                    extraArgs: options.extraArgs,
                });
                return {
                    mode: "single-agent",
                    role: request.role,
                    output: {
                        ...output,
                        dispatchMode: "codex-cli-process",
                    },
                };
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new AgentRuntimeUnavailableError(request.role, reason);
            }
        },
        async waitAgent(dispatch) {
            return dispatch;
        },
        async collectArtifacts(dispatches) {
            return dispatches.map((dispatch) => dispatch.output);
        },
    };
}
