import type { GateDecision } from "./gate-registry.js";
import type { GateHardness } from "./gate-types.js";

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

export function createConfidenceModel() {
  const thresholds = {
    medium: 0.6,
    high: 0.8,
  };

  return {
    thresholds,
    apply(input: {
      baseScore: number;
      gates: ConfidenceGateEntry[];
      dimensions?: Record<string, number | null>;
      now?: Date;
    }): ConfidenceSnapshot {
      const gate_penalty = input.gates.reduce((total, entry) => total + entry.confidence_impact, 0);
      const score = Math.max(0, Math.min(1, input.baseScore + gate_penalty));

      return {
        score,
        band: getBand(score),
        thresholds,
        gate_penalty,
        dimensions: input.dimensions ?? {},
        updated_at: (input.now ?? new Date()).toISOString(),
      };
    },
  };
}

