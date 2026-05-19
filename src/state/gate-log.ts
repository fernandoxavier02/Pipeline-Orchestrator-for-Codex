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

// Exported so tests can pin the contract instead of duplicating the literal.
// Post-review (QUAL-005): hardcoding 200 in tests let weak `<=` assertions
// pass against the literal even if truncation produced an empty string.
export const MAX_DETAIL_LENGTH = 200;

// Post-review note (ARCH-003): `source: "controller"` and
// `source: "dispatch" + dispatchMode: "real"` both collapse to
// `decided_by: "controller"` in the persisted audit log. This is intentional
// for v0.5.0 (the historical schema reserves `"controller"` for either case)
// but it means a future "per-agent blame tracking" feature would need a
// schema migration to add a distinct `"agent"` value. Document the collapse
// here so the constraint is visible to future maintainers.
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

// Post-review fix (C3): strip ALL ASCII control characters, not just CR/LF.
// Tabs (`\t`), NUL bytes (`\x00`), vertical tab (`\v`), and the C1 range
// (`\x7F-\x9F`) plus ANSI escape sequences (which begin with `\x1B`) can
// corrupt JSONL line parsing in downstream tooling and inject terminal
// control sequences into operator log viewers. Replace any run of control
// characters with a single space, then truncate to MAX_DETAIL_LENGTH.
const CONTROL_CHAR_RUN = /[\x00-\x1F\x7F-\x9F]+/g;

export function sanitizeDetail(detail: string): string {
  return detail.replace(CONTROL_CHAR_RUN, " ").slice(0, MAX_DETAIL_LENGTH);
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

    // Post-review fix (SEC-003): mkdir must run INSIDE the mutex. The previous
    // ordering ran mkdir before acquiring the lock, which left a window where
    // two concurrent in-process callers (or a single caller racing with the
    // first write of a new run) could both observe an absent directory and
    // attempt creation in parallel. Cross-process safety (multiple CLI
    // invocations against the same state root) is still NOT covered by this
    // mutex — that scenario is unsupported and would require an OS-level
    // advisory lock. See AGENTS.md / pipeline.local.md for the documented
    // single-process constraint.
    await withAppendLock(async () => {
      await mkdir(root, { recursive: true });
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
