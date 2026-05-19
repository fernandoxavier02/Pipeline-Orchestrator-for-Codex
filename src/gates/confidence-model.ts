/**
 * Confidence Model — Deterministic gate-penalty ledger.
 *
 * This is NOT an AI-evaluated quality score. It is a deterministic arithmetic
 * model that tracks how many controller gates passed vs skipped. Each gate
 * decision carries a fixed confidence_impact (from gate-registry.ts); the model
 * simply sums these impacts and clamps the result to [0, 1].
 *
 * The score reflects "how many safety gates were cleared," not "how good the
 * code is." Do not present it as an evidence-based quality metric.
 *
 * Spec: pipeline-trust-restoration / R2 — Confidence Reflects Emulation.
 * When the run contains any gate entry with `decided_by === "system"` (a
 * verdict fabricated by the local emulation path rather than produced by a
 * real spawn_agent dispatch), the score is capped at CONFIDENCE_CAP_THRESHOLD
 * and the snapshot is tagged with `confidenceSource: "emulated"`. This makes
 * Pa de Cal output distinguishable post-mortem from a fully real-agent run.
 */

import type { GateDecision } from "./gate-registry.js";
import type { GateHardness } from "./gate-types.js";

// R2 — Confidence_Cap_Threshold (fixed value per Open Question OQ-3 resolution
// in .kiro/specs/pipeline-trust-restoration/tasks.md). Simplicity over a
// sliding formula: any emulation entry caps the run at 0.5.
export const CONFIDENCE_CAP_THRESHOLD = 0.5;

export type ConfidenceSource = "real" | "emulated" | "unknown";

export interface ConfidenceGateEntry {
  gate: string;
  hardness: GateHardness;
  phase: string;
  decision: GateDecision;
  decided_by: "controller" | "user" | "system" | "resume-router";
  timestamp: string;
  detail: string;
  confidence_impact: number;
}

export interface ConfidenceSnapshot {
  score: number;
  band: "low" | "medium" | "high";
  thresholds: {
    medium: number;
    high: number;
  };
  gate_penalty: number;
  dimensions: Record<string, number | null>;
  updated_at: string;
  // R2 — Honesty fields. Optional only because legacy ConfidenceSnapshot
  // consumers may not be migrated yet (NFR-1 backward-compat). New runs
  // always populate them via apply().
  confidenceSource?: ConfidenceSource;
  emulated_entry_count?: number;
}

function getBand(score: number) {
  if (score >= 0.8) {
    return "high";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return "low";
}

function countEmulatedEntries(gates: ConfidenceGateEntry[]): number {
  let count = 0;
  for (const gate of gates) {
    if (gate.decided_by === "system") {
      count += 1;
    }
  }
  return count;
}

export function createConfidenceModel() {
  const thresholds = {
    medium: 0.6,
    high: 0.8,
  };

  return {
    thresholds,
    CONFIDENCE_CAP_THRESHOLD,
    apply(input: {
      baseScore: number;
      gates: ConfidenceGateEntry[];
      dimensions?: Record<string, number | null>;
      now?: Date;
    }): ConfidenceSnapshot {
      const gate_penalty = input.gates.reduce((total, entry) => total + entry.confidence_impact, 0);
      const arithmeticScore = Math.max(0, Math.min(1, input.baseScore + gate_penalty));

      // R2 AC 2.1 — scan in-memory gates for decided_by='system' (provenance
      // is already authoritative on disk after T1; we trust the gates parameter
      // here because callers pass the persisted entries).
      const emulated_entry_count = countEmulatedEntries(input.gates);

      let score = arithmeticScore;
      let confidenceSource: ConfidenceSource;

      if (emulated_entry_count > 0) {
        // R2 AC 2.2 — cap when emulation is present.
        score = Math.min(arithmeticScore, CONFIDENCE_CAP_THRESHOLD);
        confidenceSource = "emulated"; // R2 AC 2.3
      } else {
        confidenceSource = "real"; // R2 AC 2.4
      }

      return {
        score,
        band: getBand(score),
        thresholds,
        gate_penalty,
        dimensions: input.dimensions ?? {},
        updated_at: (input.now ?? new Date()).toISOString(),
        confidenceSource,
        emulated_entry_count,
      };
    },
  };
}
