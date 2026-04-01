import type { GateHardness } from "./gate-types.js";

export function classifyGateHardness(input: {
  blocker: boolean;
  severity: "low" | "medium" | "high";
}): GateHardness {
  if (input.blocker && input.severity === "high") {
    return "MANDATORY";
  }

  if (input.blocker) {
    return "HARD";
  }

  if (input.severity === "high") {
    return "CIRCUIT_BREAKER";
  }

  return "SOFT";
}
