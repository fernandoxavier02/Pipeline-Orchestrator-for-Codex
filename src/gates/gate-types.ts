export type GateHardness = "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT" | "AUDIT";
export type GateStatus = "passed" | "blocked" | "partial";

export interface GateResult {
  gate: string;
  status: GateStatus;
  hardness: GateHardness;
  reason: string;
  questions: string[];
  checklistIds?: string[];
}
