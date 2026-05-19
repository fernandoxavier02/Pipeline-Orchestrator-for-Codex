import { createGateRegistry } from "./gate-registry.js";
import type { ConfidenceGateEntry } from "./confidence-model.js";
import { inferDecidedBy } from "../state/gate-log.js";

const SENSITIVE_PATH_PATTERN = /(auth|crypto|security|payment|sensitive|session|token|credential)/i;
const STALE_CONTEXT_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

function isSensitiveComplexDomain(session: {
  mode?: string;
  variant?: string;
  currentPhase?: string;
  touchedFiles?: string[];
  proposal?: { affectedFiles?: string[] };
}) {
  const touchedFiles = session.touchedFiles ?? session.proposal?.affectedFiles ?? [];
  const touchesSensitiveDomain = touchedFiles.some((path) => SENSITIVE_PATH_PATTERN.test(path));
  const isComplex =
    session.mode === "--complexa"
    || (session.variant?.endsWith("heavy") ?? false)
    || session.currentPhase === "phase-2"
    || session.currentPhase === "phase-3";

  return touchesSensitiveDomain && isComplex;
}

export function assessStaleContext(input: {
  session: {
    mode?: string;
    variant?: string;
    currentPhase?: string;
    touchedFiles?: string[];
    proposal?: { affectedFiles?: string[] };
  };
  lastActivityAt: string | Date;
  now?: Date;
}): ConfidenceGateEntry | null {
  const registry = createGateRegistry();
  const gate = registry.get("STALE_CONTEXT");
  const now = input.now ?? new Date();
  const activityTime = typeof input.lastActivityAt === "string"
    ? new Date(input.lastActivityAt)
    : input.lastActivityAt;
  const ageMs = now.getTime() - activityTime.getTime();

  if (!Number.isFinite(ageMs) || ageMs < STALE_CONTEXT_WINDOW_MS) {
    return null;
  }

  const sensitiveComplexDomain = isSensitiveComplexDomain(input.session);

  return {
    gate: gate.gate,
    hardness: sensitiveComplexDomain ? "HARD" : gate.hardness,
    phase: gate.phase,
    decision: sensitiveComplexDomain ? "block" : "skip",
    decided_by: inferDecidedBy({ source: "controller" }),
    timestamp: now.toISOString(),
    detail: sensitiveComplexDomain
      ? "Stale context touches a sensitive complex domain and requires revalidation before resume"
      : "Run is stale and should be revalidated before blind resume",
    confidence_impact: sensitiveComplexDomain ? 0 : gate.confidenceImpactOnSkip,
  };
}
