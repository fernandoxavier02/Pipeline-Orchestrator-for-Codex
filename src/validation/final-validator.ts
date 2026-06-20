import { createGateRegistry } from "../gates/gate-registry.js";
import { REQUIRED_PIPELINE_GATES } from "../governance/pipeline-contract.js";
import { resolveFinalValidationEvidence } from "../review/domain-checklists.js";

type VerificationEvidence = {
  kind: string;
  passed: boolean;
  label?: string;
};

type GateLogEntry = {
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT" | "AUDIT";
  decision: "pass" | "block" | "skip" | "partial";
  phase?: string;
  decided_by?: "controller" | "user" | "system" | "resume-router";
  timestamp?: string;
  detail?: string;
  confidence_impact?: number;
};

const NON_OPERATIONAL_MODES = new Set(["diagnostic", "review-only"]);

function normalizeMode(mode: string | undefined): string | undefined {
  if (typeof mode !== "string") return undefined;
  const trimmed = mode.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isNonExemptMode(mode: string | undefined): boolean {
  const normalized = normalizeMode(mode);
  return !!normalized && !NON_OPERATIONAL_MODES.has(normalized);
}

const LATEST_ONLY_GATES = new Set(["CLOSEOUT_CONFIRM"]);
const STICKY_ROLLBACKS = new Set(["manual", "stop"]);
const DYNAMIC_BATCH_LOOP_GATE = /^BATCH_LOOP:[^:]+:(?:checkpoint|adversarial_review|fix_loop)$/u;

function gateRollbackFor(gate: string) {
  if (DYNAMIC_BATCH_LOOP_GATE.test(gate)) {
    return "revalidate";
  }
  return createGateRegistry().get(gate).rollback;
}

function getConfidenceBand(score: number): "low" | "medium" | "high" {
  if (score >= 0.8) {
    return "high";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return "low";
}

export function resolveEffectiveGateLog(entries: GateLogEntry[]) {
  const entriesByGate = new Map<string, GateLogEntry[]>();

  for (const entry of entries) {
    const history = entriesByGate.get(entry.gate) ?? [];
    history.push(entry);
    entriesByGate.set(entry.gate, history);
  }

  return [...entriesByGate.entries()].map(([, history]) => {
    const gate = history[0]?.gate ?? "";
    if (LATEST_ONLY_GATES.has(gate)) {
      return history.at(-1) as GateLogEntry;
    }

    const rollback = gateRollbackFor(gate);
    if (STICKY_ROLLBACKS.has(rollback)) {
      const blockingEntry = history.find((entry) => entry.decision === "block");
      if (blockingEntry) {
        return blockingEntry;
      }
    }

    if (rollback === "revalidate" || rollback === "replan") {
      return history.at(-1) as GateLogEntry;
    }

    const blockingEntry = history.find((entry) => entry.decision === "block");
    if (blockingEntry) {
      return blockingEntry;
    }

    return history.at(-1) as GateLogEntry;
  });
}

export function runFinalValidator(input: {
  reviews: Array<{ status: string }>;
  confidenceScore: number;
  gateLog: GateLogEntry[];
  verificationEvidence: VerificationEvidence[];
  validationIntent?: string;
  mode?: string;
  dispatchMode?: "real-agent" | "parallel-emulation" | "single-agent" | "harness" | "diagnostic-harness";
}) {
  const gateRegistry = createGateRegistry();
  const effectiveGateLog = resolveEffectiveGateLog(input.gateLog);
  const confidenceBand = getConfidenceBand(input.confidenceScore);
  const presentGateNames = new Set(effectiveGateLog.map((entry) => entry.gate));
  const missingRequiredGates = isNonExemptMode(input.mode)
    ? REQUIRED_PIPELINE_GATES.filter((gate) => !presentGateNames.has(gate))
    : [];
  const blockingGates = [
    ...effectiveGateLog
      .filter((entry) => entry.decision === "block" && entry.hardness !== "AUDIT")
      .map((entry) => entry.gate),
    ...missingRequiredGates,
  ];
  const skippedSoftGates = effectiveGateLog
    .filter((entry) => entry.hardness === "SOFT" && entry.decision === "skip")
    .map((entry) => entry.gate);
  const requiredEvidence = resolveFinalValidationEvidence({
    mode: input.mode,
    validationIntent: input.validationIntent,
  });
  const passedEvidenceKinds = new Set(
    input.verificationEvidence
      .filter((evidence) => evidence.passed)
      .map((evidence) => evidence.kind),
  );
  const missingEvidence = requiredEvidence.filter((kind) => !passedEvidenceKinds.has(kind));
  if (
    isNonExemptMode(input.mode)
    && input.validationIntent !== "reduced"
  ) {
    for (const canonicalKind of ["protocol-events", "gate-decisions", "target-latest-trace"]) {
      if (!passedEvidenceKinds.has(canonicalKind)) {
        missingEvidence.push(canonicalKind);
      }
    }
  }
  for (const gate of missingRequiredGates) {
    missingEvidence.push(`gate:${gate}`);
  }
  if (
    input.dispatchMode
    && input.dispatchMode !== "real-agent"
    && isNonExemptMode(input.mode)
  ) {
    missingEvidence.push("real-agent-dispatch");
  }
  const blockedReviews = input.reviews.filter((review) => review.status !== "approved");

  let decision: "GO" | "CONDITIONAL" | "NO-GO";
  if (blockingGates.length > 0 || blockedReviews.length > 0 || missingEvidence.length > 0 || input.confidenceScore < 0.6) {
    decision = "NO-GO";
  } else if (skippedSoftGates.length > 0 || input.confidenceScore < 0.8) {
    decision = "CONDITIONAL";
  } else {
    decision = "GO";
  }

  const rollbackHint = blockingGates
    .map((gate) => gateRollbackFor(gate))
    .find((rollback) => rollback !== "none");

  return {
    decision,
    confidenceScore: input.confidenceScore,
    confidenceBand,
    requiredEvidence,
    missingEvidence,
    verificationEvidence: input.verificationEvidence,
    blockingGates,
    missingRequiredGates,
    skippedSoftGates,
    blockedReviews: blockedReviews.length,
    rollbackHint,
  };
}

type SentinelStateInput = {
  session_id?: string;
  run_id?: string;
  workflow_id?: string;
  created_by_runtime?: boolean;
  runtime_mode?: "real-agent" | "harness" | "blocked-no-agent-runtime" | "dev-bypass";
  pipelineActive: boolean;
  currentPhase: "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3";
  currentAgent: string;
  expectedNext: string[];
  completedPhases: Array<"phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3">;
  gateSummary: string[];
  batchState: { batchIndex: number; status: string };
  consecutiveCorrections: number;
  lastCheckpoint:
    | "post_orchestrator"
    | "phase_0_to_1"
    | "phase_1_to_2"
    | "phase_2_to_3"
    | "post_final_validator";
  updatedAt: string;
};

type SentinelStoreLike = {
  save?: (state: SentinelStateInput) => Promise<void> | void;
  load?: () => Promise<SentinelStateInput> | SentinelStateInput;
};

/**
 * After a final-validator dispatch returns, persist the
 * `post_final_validator` checkpoint so sentinel can confirm the pipeline
 * reached the final gate. Idempotent: callers that have no sentinel store
 * (e.g. unit fixtures) get a no-op.
 */
export async function recordPostFinalValidatorCheckpoint(input: {
  sentinelStore?: SentinelStoreLike;
  decision: "GO" | "CONDITIONAL" | "NO-GO";
  consecutiveCorrections?: number;
  batchIndex?: number;
}): Promise<void> {
  if (!input.sentinelStore?.save) {
    return;
  }
  let prior: SentinelStateInput | undefined;
  try {
    prior = (await input.sentinelStore.load?.()) ?? undefined;
  } catch {
    prior = undefined;
  }
  const completed: SentinelStateInput["completedPhases"] = Array.from(
    new Set([...(prior?.completedPhases ?? []), "phase-2", "phase-3"]),
  );
  await input.sentinelStore.save({
    ...(prior?.session_id ? { session_id: prior.session_id } : {}),
    ...(prior?.run_id ? { run_id: prior.run_id } : {}),
    ...(prior?.workflow_id ? { workflow_id: prior.workflow_id } : {}),
    ...(typeof prior?.created_by_runtime === "boolean" ? { created_by_runtime: prior.created_by_runtime } : {}),
    ...(prior?.runtime_mode ? { runtime_mode: prior.runtime_mode } : {}),
    pipelineActive: input.decision === "NO-GO" ? true : false,
    currentPhase: "phase-3",
    currentAgent: "final-validator",
    expectedNext: [],
    completedPhases: completed,
    gateSummary: [...(prior?.gateSummary ?? []), "SENTINEL_CHECKPOINT"],
    batchState: {
      batchIndex: input.batchIndex ?? prior?.batchState.batchIndex ?? 0,
      status: `post-final-validator:${input.decision.toLowerCase()}`,
    },
    consecutiveCorrections: input.consecutiveCorrections ?? prior?.consecutiveCorrections ?? 0,
    lastCheckpoint: "post_final_validator",
    updatedAt: new Date().toISOString(),
  });
}

export function runSanityChecker(input: {
  verificationEvidence: VerificationEvidence[];
  validationIntent?: string;
  mode?: string;
}) {
  const requiredEvidence = resolveFinalValidationEvidence({
    mode: input.mode,
    validationIntent: input.validationIntent,
  });
  const passedEvidenceKinds = new Set(
    input.verificationEvidence
      .filter((evidence) => evidence.passed)
      .map((evidence) => evidence.kind),
  );
  const missingEvidence = requiredEvidence.filter((kind) => !passedEvidenceKinds.has(kind));
  const evidence = input.verificationEvidence
    .filter((entry) => entry.passed)
    .map((entry) => entry.label ?? entry.kind);

  return {
    status: missingEvidence.length === 0 ? "approved" as const : "blocked" as const,
    requiredEvidence,
    missingEvidence,
    evidence,
    nextAction: missingEvidence.length === 0 ? "proceed-to-final-validator" : "stop-closeout",
  };
}
