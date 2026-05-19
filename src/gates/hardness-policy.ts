// Spec: pipeline-trust-restoration / R9 — Single Authority for Gate Hardness.
//
// **DEMOTED (2026-05-19):** This utility is NOT the canonical source of gate
// hardness for the 26 statically-registered gates. Those live in
// `src/gates/gate-registry.ts` (literal `hardness` field per entry — the
// authoritative catalogue).
//
// `classifyGateHardness` is retained for the narrow dynamic case where the
// gate decision depends on a runtime (blocker, severity) input rather than a
// pre-registered gate name — currently consumed by
// `src/gates/information-gate.ts`. The CI consistency test in
// `tests/unit/gates/gate-hardness-consistency.test.ts` cross-checks the
// inferred semantics of the registry literals (Theme D defense — prevents
// silent drift between the static catalog and this dynamic classifier).

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
