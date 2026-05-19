import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gateDecisionSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { resolveValidatedRoot } from "./path-validation.js";

// Spec: pipeline-trust-restoration / R1 — Distinguishable Emulated Dispatches.
// This module is the SINGLE authorized writer for gate-decisions.jsonl. Callers
// must pass provenance (not a hardcoded decided_by literal). inferDecidedBy
// translates provenance to the schema-enforced decided_by value. The lint test
// in tests/unit/lint/decided-by-centralization.test.ts forbids hardcoded
// `decided_by: "..."` literals anywhere else in src/ (Theme D defense).

export type DecidedBy = "controller" | "user" | "system" | "resume-router";
export type DispatchMode = "real" | "emulated";

export type Provenance =
  | { source: "user" }
  | { source: "controller" }
  | { source: "resume-router" }
  | { source: "dispatch"; dispatchMode: DispatchMode };

export interface RecordGateInput {
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
  phase: string;
  decision: "pass" | "block" | "skip" | "partial";
  detail: string;
  confidence_impact?: number;
  provenance: Provenance;
  timestamp?: string;
}

const MAX_DETAIL_LENGTH = 200;

export function inferDecidedBy(provenance: Provenance): DecidedBy {
  switch (provenance.source) {
    case "user":
      return "user";
    case "controller":
      return "controller";
    case "resume-router":
      return "resume-router";
    case "dispatch":
      return provenance.dispatchMode === "emulated" ? "system" : "controller";
    default: {
      // R1 AC 1.3 — refuse to write when provenance is indeterminable.
      const exhaustive: never = provenance;
      throw new Error(
        `gate-log: indeterminable provenance ${JSON.stringify(exhaustive)} (R1 AC 1.3)`,
      );
    }
  }
}

export function sanitizeDetail(detail: string): string {
  return detail.replace(/[\r\n]+/g, " ").slice(0, MAX_DETAIL_LENGTH);
}

// Simple process-level mutex for concurrent append operations.
// This prevents JSONL line interleaving when multiple agents append simultaneously.
let appendMutex: Promise<void> = Promise.resolve();

async function withAppendLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await appendMutex.then(() => {
    let resolve: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    appendMutex = appendMutex.then(() => promise);
    return resolve!;
  });
  try {
    return await fn();
  } finally {
    release();
  }
}

export function createGateLog(root: string) {
  const validatedRoot = resolveValidatedRoot(root);
  const file = join(validatedRoot, "gate-decisions.jsonl");

  async function appendImpl(decision: unknown) {
    const parsed = gateDecisionSchema.parse(decision);
    const enriched = {
      ...parsed,
      execution_identity: parsed.execution_identity ?? createExecutionIdentity({
        surface: "gate-log",
        cwd: process.cwd(),
        stateRoot: root,
        source: "runtime",
      }),
    };

    await mkdir(root, { recursive: true });
    await withAppendLock(async () => {
      await appendFile(file, `${JSON.stringify(enriched)}\n`, "utf8");
    });
  }

  return {
    root: validatedRoot,
    append: appendImpl,
    async record(input: RecordGateInput): Promise<void> {
      const decided_by = inferDecidedBy(input.provenance);
      const entry = {
        gate: input.gate,
        hardness: input.hardness,
        phase: input.phase,
        decision: input.decision,
        decided_by,
        timestamp: input.timestamp ?? new Date().toISOString(),
        detail: sanitizeDetail(input.detail),
        confidence_impact: input.confidence_impact ?? 0,
      };
      await appendImpl(entry);
    },
    async list() {
      try {
        const raw = await readFile(file, "utf8");
        const lines = raw.split("\n").filter((line) => line.length > 0);
        const parsed = [];
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          let json;
          try {
            json = JSON.parse(line);
          } catch (jsonError) {
            // B10: tolerate a syntactically-truncated JSON object only when
            // it's on the last line (jsonl crash recovery). Schema/Zod
            // errors and partial JSON elsewhere are always fatal.
            const isLastLine = index === lines.length - 1;
            if (isLastLine) {
              continue;
            }
            throw jsonError;
          }
          parsed.push(gateDecisionSchema.parse(json));
        }
        return parsed;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}

// R1 — Top-level convenience for callers that don't hold a createGateLog instance.
// Routes through the same atomic append path via createGateLog.
export async function recordGateDecision(
  input: RecordGateInput & { pipelineDocPath: string },
): Promise<void> {
  const { pipelineDocPath, ...rest } = input;
  const log = createGateLog(pipelineDocPath);
  await log.record(rest);
}
