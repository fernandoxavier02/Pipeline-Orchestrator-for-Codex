import type { GateHardness } from "./gate-types.js";

export type GateDecision = "pass" | "block" | "skip" | "partial";
export type GatePhase = "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3" | "continue";

export interface GateDefinition {
  gate: string;
  hardness: GateHardness;
  phase: GatePhase;
  defaultDecision: GateDecision;
  confidenceImpactOnSkip: number;
  rollback: "none" | "revalidate" | "replan" | "stop" | "manual";
}

const GATE_REGISTRY: Record<string, GateDefinition> = {
  SSOT_CONFLICT: {
    gate: "SSOT_CONFLICT",
    hardness: "MANDATORY",
    phase: "phase-0",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "manual",
  },
  ADVERSARIAL_GATE_MANDATORY: {
    gate: "ADVERSARIAL_GATE_MANDATORY",
    hardness: "MANDATORY",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "manual",
  },
  INFO_GATE_BLOCKED: {
    gate: "INFO_GATE_BLOCKED",
    hardness: "HARD",
    phase: "phase-0",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "revalidate",
  },
  INFO_GATE_OK: {
    gate: "INFO_GATE_OK",
    hardness: "SOFT",
    phase: "phase-0",
    defaultDecision: "pass",
    confidenceImpactOnSkip: 0,
    rollback: "none",
  },
  DESIGN_INTERROGATION: {
    gate: "DESIGN_INTERROGATION",
    hardness: "SOFT",
    phase: "phase-0",
    defaultDecision: "partial",
    confidenceImpactOnSkip: 0,
    rollback: "none",
  },
  TDD_APPROVAL: {
    gate: "TDD_APPROVAL",
    hardness: "HARD",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "revalidate",
  },
  PLAN_REJECTED: {
    gate: "PLAN_REJECTED",
    hardness: "HARD",
    phase: "phase-1.5",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "replan",
  },
  STOP_RULE: {
    gate: "STOP_RULE",
    hardness: "CIRCUIT_BREAKER",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "stop",
  },
  FIX_LOOP_EXHAUSTED: {
    gate: "FIX_LOOP_EXHAUSTED",
    hardness: "CIRCUIT_BREAKER",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "stop",
  },
  STALE_CONTEXT: {
    gate: "STALE_CONTEXT",
    hardness: "SOFT",
    phase: "continue",
    defaultDecision: "skip",
    confidenceImpactOnSkip: -0.1,
    rollback: "revalidate",
  },
  MICRO_GATE_GAP: {
    gate: "MICRO_GATE_GAP",
    hardness: "HARD",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "revalidate",
  },
  CHECKPOINT_FAIL: {
    gate: "CHECKPOINT_FAIL",
    hardness: "HARD",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "revalidate",
  },
  ADVERSARIAL_BLOCK: {
    gate: "ADVERSARIAL_BLOCK",
    hardness: "HARD",
    phase: "phase-2",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "revalidate",
  },
  ADVERSARIAL_GATE: {
    gate: "ADVERSARIAL_GATE",
    hardness: "SOFT",
    phase: "phase-2",
    defaultDecision: "skip",
    confidenceImpactOnSkip: -0.15,
    rollback: "none",
  },
  FINAL_ADVERSARIAL_GATE: {
    gate: "FINAL_ADVERSARIAL_GATE",
    hardness: "SOFT",
    phase: "phase-3",
    defaultDecision: "skip",
    confidenceImpactOnSkip: -0.15,
    rollback: "none",
  },
  FINAL_ADVERSARIAL_REWORK: {
    gate: "FINAL_ADVERSARIAL_REWORK",
    hardness: "HARD",
    phase: "phase-3",
    defaultDecision: "block",
    confidenceImpactOnSkip: 0,
    rollback: "replan",
  },
  CLOSEOUT_CONFIRM: {
    gate: "CLOSEOUT_CONFIRM",
    hardness: "SOFT",
    phase: "phase-3",
    defaultDecision: "skip",
    confidenceImpactOnSkip: -0.05,
    rollback: "none",
  },
  REDUCED_VALIDATION_USAGE: {
    gate: "REDUCED_VALIDATION_USAGE",
    hardness: "SOFT",
    phase: "phase-3",
    defaultDecision: "pass",
    confidenceImpactOnSkip: 0,
    rollback: "none",
  },
};

export function createGateRegistry() {
  return {
    list() {
      return Object.values(GATE_REGISTRY);
    },
    get(gate: string) {
      const definition = GATE_REGISTRY[gate];
      if (!definition) {
        const supported = Object.keys(GATE_REGISTRY).sort().join(", ");
        throw new Error(`Unknown gate "${gate}". Supported gates: ${supported}`);
      }

      return definition;
    },
    confidenceImpactFor(gate: string, decision: GateDecision) {
      const definition = this.get(gate);
      if (decision === "skip") {
        return definition.confidenceImpactOnSkip;
      }

      return 0;
    },
  };
}
