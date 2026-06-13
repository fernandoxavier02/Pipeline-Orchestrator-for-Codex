import { createGateRegistry } from "../gates/gate-registry.js";

type ContinueSessionState = {
  currentPhase?: string;
  pendingDecision?: string;
  unresolvedBlockers?: string[];
};

export type PersistedGateLogEntry = {
  gate: string;
  decision: "pass" | "block" | "skip" | "partial";
  detail: string;
  timestamp: string;
  hardness?: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT" | "AUDIT";
  decided_by?: "controller" | "user" | "system" | "resume-router";
  confidence_impact?: number;
};

export function resolveContinueRollbackState(input: {
  session: ContinueSessionState;
  gateLogEntries?: PersistedGateLogEntry[];
}) {
  const pendingDecision = input.session.pendingDecision;
  if (!pendingDecision) {
    return null;
  }

  if (pendingDecision === "resume") {
    return null;
  }

  // F4 — Distinct sentinel for light workflows that just transitioned from
  // phase-1 to phase-2 via the controller-managed-transition path. Treated
  // like "resume" for rollback purposes (no rollback), but disambiguated so
  // callers can tell a fresh confirmation apart from a generic resume.
  if (pendingDecision === "phase-2-ready") {
    return null;
  }

  const allowedDecisions = new Set(["stop", "revalidate", "phase-2-proof-required", "replan", "manual"]);
  const specPendingDecisionRoutes = new Map<string, "revalidate" | "replan">([
    ["spec-artifacts-required", "replan"],
    ["spec-content-review-required", "replan"],
    ["spec-traceability-required", "revalidate"],
    ["spec-post-implementation-required", "replan"],
  ]);
  const phaseOnePointFiveApprovalDecisions = new Set([
    "phase-1.5-approval-required",
    "phase-1.5-reapproval-required",
  ]);

  if (
    !allowedDecisions.has(pendingDecision)
    && !phaseOnePointFiveApprovalDecisions.has(pendingDecision)
    && !specPendingDecisionRoutes.has(pendingDecision)
  ) {
    throw new Error(`Unknown continue pending decision "${pendingDecision}"`);
  }

  if (phaseOnePointFiveApprovalDecisions.has(pendingDecision)) {
    if (input.session.currentPhase !== "phase-1.5") {
      throw new Error(`Unknown continue pending decision "${pendingDecision}"`);
    }

    const candidateRollbackGate = input.session.unresolvedBlockers?.[0] ?? "TDD_APPROVAL";
    let rollbackGate = candidateRollbackGate;
    try {
      createGateRegistry().get(candidateRollbackGate);
    } catch {
      rollbackGate = "TDD_APPROVAL";
    }

    return {
      phase: input.session.currentPhase,
      resumeBlocked: true,
      rollbackGate,
      rollbackRoute: "revalidate",
      rollbackDecision: "block" as const,
      revalidationRequired: true,
    };
  }

  const normalizedRollbackRoute = specPendingDecisionRoutes.get(pendingDecision)
    ?? (pendingDecision === "phase-2-proof-required"
    ? "revalidate"
    : pendingDecision);

  const rollbackFromGateLog = resolveRollbackRoute(input.gateLogEntries ?? []);
  const hasGateHistory = (input.gateLogEntries ?? []).length > 0;
  const unresolvedBlocker = input.session.unresolvedBlockers?.[0];
  const rollbackGate = rollbackFromGateLog?.rollback === normalizedRollbackRoute
    ? rollbackFromGateLog.gate
    : normalizedRollbackRoute === "revalidate"
      ? (!hasGateHistory ? unresolvedBlocker : undefined)
      : normalizedRollbackRoute === "stop"
        ? unresolvedBlocker ?? "STOP_RULE"
        : unresolvedBlocker;
  if (!rollbackGate) {
    if (normalizedRollbackRoute === "revalidate" && hasGateHistory && (input.session.unresolvedBlockers?.length ?? 0) > 0) {
      return null;
    }

    throw new Error("Unable to resolve blocked continue rollback metadata");
  }

  try {
    createGateRegistry().get(rollbackGate);
  } catch {
    if (normalizedRollbackRoute === "revalidate" && hasGateHistory && (input.session.unresolvedBlockers?.length ?? 0) > 0) {
      return null;
    }

    throw new Error("Unable to resolve blocked continue rollback metadata");
  }

  return {
    phase: input.session.currentPhase,
    resumeBlocked: true,
    rollbackGate,
    rollbackRoute: normalizedRollbackRoute,
    rollbackDecision: "block" as const,
    revalidationRequired: normalizedRollbackRoute === "revalidate",
  };
}

export function resolveContinueResumeState(input: {
  session: {
    currentPhase: string;
  };
  checkpoints: Array<{ name: string; status: string }>;
}) {
  const lastCompleted = [...input.checkpoints]
    .reverse()
    .find((entry) => entry.status === "completed");

  if (!lastCompleted) {
    if (input.session.currentPhase === "phase-3") {
      return {
        resumeFrom: "phase-3",
        nextPhase: "phase-3",
      };
    }

    throw new Error("No completed checkpoint available to resume");
  }

  return {
    resumeFrom: lastCompleted.name,
    nextPhase: input.session.currentPhase,
  };
}

function resolveRollbackRoute(entries: PersistedGateLogEntry[]) {
  const latest = [...entries]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
  if (!latest) {
    return null;
  }

  const definition = createGateRegistry().get(latest.gate);

  if (definition.rollback === "none" || latest.decision === "pass") {
    return null;
  }

  return {
    gate: latest.gate,
    decision: latest.decision,
    rollback: definition.rollback,
    detail: latest.detail,
  } as const;
}
