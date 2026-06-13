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
import type { RuntimeOptions } from "../domain/pipeline-types.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { loadAgentRuntimeAdapter } from "./agent-runtime-loader.js";
import { sentinelStateSchema, sessionStateSchema } from "../domain/pipeline-schemas.js";

export function resolveCliExitCode(result: unknown) {
  if (!result || typeof result !== "object") {
    return 1;
  }

  const status = (result as { status?: unknown }).status;
  if (typeof status === "string" && status.toLowerCase().startsWith("blocked")) {
    return 1;
  }

  if ((result as { ok?: unknown }).ok === false) {
    return 1;
  }

  return 0;
}

type PipelineCliOptions = RuntimeOptions & {
  mode?: string;
  task?: string;
  continue?: boolean;
  agentRuntimeAdapter?: string;
};

type GateResponse = "yes" | "no" | "adjust";

type PendingGateResolution =
  | { kind: "none" }
  | { kind: "response"; response: GateResponse }
  | { kind: "blocked"; result: Record<string, unknown> };

const SENTINEL_HMAC_ENV = "PIPELINE_SENTINEL_HMAC_KEY";
const SENTINEL_STALE_THRESHOLD_MS = 300_000;

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const options: PipelineCliOptions = {
    cwd: process.cwd(),
    codexHome: process.env.CODEX_HOME || process.cwd(),
  };

  let taskParts: string[] = [];

  for (const arg of args) {
    if (arg === "--continue") {
      options.continue = true;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg.startsWith("--strict-agents")) {
      options.strictAgents = true;
    } else if (arg.startsWith("--agent-runtime-adapter=")) {
      options.agentRuntimeAdapter = arg.slice("--agent-runtime-adapter=".length);
    } else if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
    } else if (!arg.startsWith("-")) {
      taskParts.push(arg);
    }
  }

  options.task = taskParts.join(" ").trim() || undefined;
  return options;
}

function blockedPendingGateState(detail: string) {
  return {
    status: "BLOCKED",
    reason: "blocked-invalid-pending-gate-state",
    pipeline_valid: false,
    blockedBy: "CLI_PENDING_GATE_STATE",
    detail,
  };
}

function readJsonFile(path: string) {
  try {
    if (!existsSync(path)) return { kind: "missing" as const };
    return { kind: "loaded" as const, value: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch {
    return { kind: "invalid" as const };
  }
}

function isGateResponse(task: string): task is GateResponse {
  return task === "yes" || task === "no" || task === "adjust";
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function sentinelIntegrityVerified(rawSentinel: unknown) {
  const key = process.env[SENTINEL_HMAC_ENV];
  if (!key) return true;
  if (!rawSentinel || typeof rawSentinel !== "object" || Array.isArray(rawSentinel)) {
    return false;
  }

  const integrity = (rawSentinel as { _integrity?: unknown })._integrity;
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    return false;
  }

  const algorithm = (integrity as { algorithm?: unknown }).algorithm;
  const signature = (integrity as { signature?: unknown }).signature;
  if (algorithm !== "hmac-sha256" || typeof signature !== "string") {
    return false;
  }

  const unsignedState = { ...(rawSentinel as Record<string, unknown>) };
  delete unsignedState._integrity;
  const expected = createHmac("sha256", key).update(canonicalize(unsignedState)).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(signature, "hex");
  return actualBytes.length > 0
    && expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

function sentinelIsFresh(updatedAt: string) {
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return false;
  const ageMs = Date.now() - updatedAtMs;
  return ageMs >= 0 && ageMs <= SENTINEL_STALE_THRESHOLD_MS;
}

function expectedGateShape(session: ReturnType<typeof sessionStateSchema.parse>) {
  const hasPendingProposal =
    session.proposal?.awaitingUserConfirmation === true
    && session.proposal.affectedFiles.length > 0;

  if (
    session.currentPhase === "phase-1"
    && session.pendingDecision === "proposal-confirmation"
    && hasPendingProposal
  ) {
    return {
      expectedToken: "proposal-response",
      expectedBatchStatus: "awaiting-proposal-confirmation",
    };
  }

  if (
    session.currentPhase === "phase-1.5"
    && session.pendingDecision === "phase-1.5-approval-required"
    && hasPendingProposal
    && session.approvalProof?.kind === "controller-managed-transition"
    && session.approvalProof.from === "phase-1"
    && session.approvalProof.to === "phase-1.5"
  ) {
    return {
      expectedToken: "phase-1.5-response",
      expectedBatchStatus: "awaiting-plan-approval",
    };
  }

  if (
    session.currentPhase === "phase-1.5"
    && session.pendingDecision === "phase-1.5-reapproval-required"
    && hasPendingProposal
    && session.approvalProof?.kind === "controller-managed-transition"
    && session.approvalProof.from === "phase-1"
    && session.approvalProof.to === "phase-1.5"
  ) {
    return {
      expectedToken: "phase-1.5-response",
      expectedBatchStatus: "awaiting-plan-reapproval",
    };
  }

  return undefined;
}

function pendingGateResponse(options: PipelineCliOptions): PendingGateResolution {
  if (options.continue || options.mode || !options.task) return { kind: "none" };

  const response = options.task.trim().toLowerCase();
  if (!isGateResponse(response)) return { kind: "none" };

  const stateDir = join(options.cwd ?? process.cwd(), ".codex", "pipeline");
  const session = readJsonFile(join(stateDir, "session.json"));
  const sentinel = readJsonFile(join(stateDir, "sentinel-state.json"));

  if (session.kind === "missing" && sentinel.kind === "missing") {
    return { kind: "none" };
  }

  if (session.kind !== "loaded" || sentinel.kind !== "loaded") {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received with missing or unreadable pipeline state."),
    };
  }

  if (!sentinelIntegrityVerified(sentinel.value)) {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received with unsigned or invalid sentinel integrity metadata."),
    };
  }

  const parsedSession = sessionStateSchema.safeParse(session.value);
  const parsedSentinel = sentinelStateSchema.safeParse(sentinel.value);
  if (!parsedSession.success || !parsedSentinel.success) {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received with invalid pending pipeline state."),
    };
  }

  if (!sentinelIsFresh(parsedSentinel.data.updatedAt)) {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received with stale pending gate sentinel state."),
    };
  }

  const gateShape = expectedGateShape(parsedSession.data);
  const phaseAliasMatches =
    parsedSession.data.phase === undefined
    || parsedSession.data.phase === parsedSession.data.currentPhase;

  if (!gateShape || !phaseAliasMatches) {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received, but no pending response gate is active."),
    };
  }

  const sentinelMatchesGate =
    parsedSentinel.data.pipelineActive
    && parsedSentinel.data.currentPhase === parsedSession.data.currentPhase
    && parsedSentinel.data.currentAgent === "pipeline-controller"
    && parsedSentinel.data.expectedNext.length === 1
    && parsedSentinel.data.expectedNext[0] === gateShape.expectedToken
    && parsedSentinel.data.batchState.batchIndex === parsedSession.data.batchIndex
    && parsedSentinel.data.batchState.status === gateShape.expectedBatchStatus;

  if (!sentinelMatchesGate) {
    return {
      kind: "blocked",
      result: blockedPendingGateState("Bare yes/no/adjust received with inconsistent pending gate sentinel state."),
    };
  }

  return { kind: "response", response };
}

export async function runPipelineCli(options: PipelineCliOptions) {
  const gateResponse = pendingGateResponse(options);
  if (gateResponse.kind === "blocked") {
    return gateResponse.result;
  }

  const agentRuntime = options.agentRuntime
    ?? await loadAgentRuntimeAdapter(options.agentRuntimeAdapter ?? process.env.CODEX_AGENT_RUNTIME_ADAPTER);

  // R6 AC 6.2 — on continue, if the caller did not pass --strict-agents,
  // honor the value persisted in the latest session.json. Legacy sessions
  // (no field) keep strictAgents as undefined and the cascade applies fresh.
  let effectiveStrictAgents: boolean | undefined = options.strictAgents;
  if (options.continue && effectiveStrictAgents === undefined) {
    try {
      const { findLatestRun } = await import("../continue/find-latest-run.js");
      const { loadPersistedStrictAgents } = await import("../state/session-store.js");
      const stateDir = join(options.cwd ?? process.cwd(), ".codex", "pipeline");
      const latestRun = await findLatestRun(stateDir);
      if (latestRun?.runDir) {
        effectiveStrictAgents = await loadPersistedStrictAgents(latestRun.runDir);
      }
    } catch {
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

  const input = gateResponse.kind === "response"
    ? gateResponse.response
    : (options.continue
    ? "/pipeline-orchestrator-for-codex:pipeline continue"
    : options.mode
      ? `/pipeline-orchestrator-for-codex:pipeline ${options.mode} ${options.task}`
      : `/pipeline-orchestrator-for-codex:pipeline ${options.task}`);

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
  } catch (error) {
    console.error("Pipeline execution failed:", error);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
