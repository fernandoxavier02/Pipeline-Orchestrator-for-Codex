import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentDispatchRequest,
  AgentRuntimeAdapter,
  DispatchResult,
} from "../dispatcher/dispatcher-types.js";
import { AgentRuntimeUnavailableError } from "../dispatcher/run-role.js";

export interface CodexCliProcessRuntimeOptions {
  codexBin?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  extraArgs?: string[];
}

function buildPrompt(request: AgentDispatchRequest): string {
  const roleSpecificContract =
    request.role === "quality-gate-router"
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

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { status: "blocked", summary: "codex child returned empty output", evidence: [] };
  }

  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed) return parsed;
  }

  return {
    status: "completed",
    summary: trimmed.slice(0, 4000),
    evidence: [trimmed.slice(0, 4000)],
  };
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function runCodexExec(
  prompt: string,
  options: Required<Pick<CodexCliProcessRuntimeOptions, "codexBin" | "cwd" | "timeoutMs">>
    & Pick<CodexCliProcessRuntimeOptions, "model" | "extraArgs">,
): Promise<Record<string, unknown>> {
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.codexBin, args, {
        cwd: options.cwd,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`codex exec timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stderr.on("data", (chunk: Buffer) => {
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
        } else {
          reject(new Error(`codex exec exited with ${code}: ${stderr.slice(0, 2000)}`));
        }
      });
      child.stdin.end(prompt);
    });

    const raw = await readFile(outputPath, "utf8").catch(() => "");
    return extractJsonObject(raw);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function createCodexCliProcessRuntime(
  options: CodexCliProcessRuntimeOptions = {},
): AgentRuntimeAdapter {
  const codexBin = options.codexBin ?? process.env.CODEX_CLI_PATH ?? "codex";
  const cwd = options.cwd ?? process.cwd();
  const configuredTimeout = Number(process.env.CODEX_CLI_PROCESS_TIMEOUT_MS);
  const timeoutMs = options.timeoutMs
    ?? (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000);

  return {
    runtimeMode: "dev-bypass",
    capabilities: {
      spawnAgent: true,
      waitAgent: true,
      collectArtifacts: true,
      recordGates: true,
      recordCheckpoints: true,
      structuredFinalState: true,
    },
    async spawnAgent(request: AgentDispatchRequest): Promise<DispatchResult> {
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
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new AgentRuntimeUnavailableError(request.role, reason);
      }
    },
    async waitAgent(dispatch: DispatchResult): Promise<DispatchResult> {
      return dispatch;
    },
    async collectArtifacts(dispatches: DispatchResult[]): Promise<Record<string, unknown>[]> {
      return dispatches.map((dispatch) => dispatch.output);
    },
  };
}
