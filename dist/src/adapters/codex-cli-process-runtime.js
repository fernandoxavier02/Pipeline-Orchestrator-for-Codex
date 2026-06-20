import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { AgentRuntimeUnavailableError } from "../dispatcher/run-role.js";
function buildPrompt(request) {
    const roleSpecificContract = request.role === "quality-gate-router"
        ? [
            "For role quality-gate-router, return JSON with exactly this shape:",
            "{",
            '  "batchSize": number,',
            '  "regressionProofs": number,',
            '  "approvedScenarios": ["tests/path-or-report-evidence-id"],',
            '  "batches": [{ "name": "batch-1", "tasks": ["file-or-task"], "parallel_eligible": false, "parallel_reason": "why" }]',
            "}",
        ].join("\n")
        : request.role === "pre-tester"
            ? [
                "For role pre-tester, return JSON with exactly this shape:",
                "{",
                '  "approvedScenarios": ["tests/path-or-report-evidence-id"],',
                '  "tddApproval": "APPROVED",',
                '  "redValidation": { "status": "approved", "reasons": [] }',
                "}",
            ].join("\n")
            : request.role === "checkpoint-validator"
                ? [
                    "For role checkpoint-validator, return JSON with exactly this shape:",
                    "{",
                    '  "status": "passed",',
                    '  "checkpointName": "batch-1",',
                    '  "consecutiveFailures": 0,',
                    '  "requiredCheckpoints": 1,',
                    '  "verifiedCheckpoints": 1,',
                    '  "coverage": 1',
                    "}",
                ].join("\n")
                : [
                    "Return ONLY a single JSON object. Do not wrap it in markdown.",
                    "The object must include: status, role, summary, evidence.",
                ].join("\n");
    return [
        `PIPELINE_AGENT_FQN: ${request.role}`,
        "",
        "You are a Codex CLI child worker for Pipeline Orchestrator.",
        roleSpecificContract,
        "",
        "EXPECTED_OUTPUT:",
        JSON.stringify(request.expectedOutput, null, 2),
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
    const args = buildCodexExecArgs(options, outputPath);
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
export function buildCodexExecBaseArgs(options) {
    const sandbox = options.sandbox ?? "workspace-write";
    const extraArgs = options.extraArgs ?? [];
    if (!options.allowDangerousBypass && extraArgs.some((arg) => arg.startsWith("--dangerously-bypass-"))) {
        throw new Error("codex-cli-process runtime refuses dangerous bypass flags unless allowDangerousBypass=true.");
    }
    return [
        "exec",
        ...(options.allowDangerousBypass ? [
            "--dangerously-bypass-approvals-and-sandbox",
            "--dangerously-bypass-hook-trust",
        ] : ["--sandbox", sandbox]),
        "-C",
        options.cwd,
        ...(options.model ? ["-m", options.model] : []),
        ...extraArgs,
    ];
}
function buildCodexExecArgs(options, outputPath) {
    return [
        ...buildCodexExecBaseArgs(options),
        "-o",
        outputPath,
        "-",
    ];
}
function hasPathSeparator(value) {
    return value.includes("/") || value.includes("\\") || value.includes(sep);
}
function existingFile(path) {
    try {
        return existsSync(path);
    }
    catch {
        return false;
    }
}
function vscodeCodexCandidates() {
    const extensionsRoot = join(homedir(), ".vscode", "extensions");
    try {
        return readdirSync(extensionsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-.*-win32-x64$/iu.test(entry.name))
            .map((entry) => join(extensionsRoot, entry.name, "bin", "windows-x86_64", "codex.exe"))
            .filter(existingFile)
            .sort()
            .reverse();
    }
    catch {
        return [];
    }
}
function pathCodexCandidates() {
    return (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .flatMap((entry) => [join(entry, "codex.exe"), join(entry, "codex.cmd")])
        .filter(existingFile);
}
export function resolveCodexCliBinary(candidate) {
    const requested = candidate ?? process.env.CODEX_CLI_PATH ?? "codex";
    if (process.platform !== "win32") {
        return requested;
    }
    if (hasPathSeparator(requested)) {
        return resolve(requested);
    }
    const candidates = [
        ...vscodeCodexCandidates(),
        ...pathCodexCandidates().filter((entry) => entry.toLowerCase().endsWith("codex.exe")),
        ...pathCodexCandidates().filter((entry) => !entry.toLowerCase().includes("windowsapps")),
    ];
    return candidates[0] ?? requested;
}
export function createCodexCliProcessRuntime(options = {}) {
    const codexBin = resolveCodexCliBinary(options.codexBin);
    const cwd = options.cwd ?? process.cwd();
    const configuredTimeout = Number(process.env.CODEX_CLI_PROCESS_TIMEOUT_MS);
    const timeoutMs = options.timeoutMs
        ?? (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000);
    return {
        runtimeMode: options.allowDangerousBypass ? "dev-bypass" : "real-agent",
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
                    sandbox: options.sandbox,
                    allowDangerousBypass: options.allowDangerousBypass,
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
