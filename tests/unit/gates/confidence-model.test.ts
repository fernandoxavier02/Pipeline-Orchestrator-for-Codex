// Spec: pipeline-trust-restoration / R2 — Confidence Reflects Emulation
// Covers: R2 AC 2.1, 2.2, 2.3, 2.4 + Property P3 (Confidence Monotonicity)

import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_CAP_THRESHOLD,
  createConfidenceModel,
  type ConfidenceGateEntry,
} from "../../../src/gates/confidence-model.js";

function makeEntry(overrides: Partial<ConfidenceGateEntry> = {}): ConfidenceGateEntry {
  return {
    gate: "INFO_GATE_BLOCKED",
    hardness: "MANDATORY",
    phase: "phase-0",
    decision: "pass",
    decided_by: "controller",
    timestamp: "2026-05-19T00:00:00.000Z",
    detail: "ok",
    confidence_impact: 0,
    ...overrides,
  };
}

describe("Confidence Model — emulation-aware cap (R2)", () => {
  it("R2 AC 2.4: confidenceSource='real' and no cap when zero system entries", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "controller" }),
        makeEntry({ decided_by: "user" }),
      ],
    });

    expect(snapshot.confidenceSource).toBe("real");
    expect(snapshot.emulated_entry_count).toBe(0);
    expect(snapshot.score).toBe(1);
  });

  it("R2 AC 2.2 + 2.3: caps final_score to 0.5 and tags emulated when ≥1 system entry", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "controller" }),
        makeEntry({ decided_by: "system", confidence_impact: 0 }),
      ],
    });

    expect(snapshot.score).toBeLessThanOrEqual(CONFIDENCE_CAP_THRESHOLD);
    expect(snapshot.confidenceSource).toBe("emulated");
    expect(snapshot.emulated_entry_count).toBe(1);
  });

  it("counts multiple system entries", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "system" }),
        makeEntry({ decided_by: "system" }),
        makeEntry({ decided_by: "system" }),
        makeEntry({ decided_by: "controller" }),
      ],
    });

    expect(snapshot.emulated_entry_count).toBe(3);
    expect(snapshot.confidenceSource).toBe("emulated");
    expect(snapshot.score).toBeLessThanOrEqual(CONFIDENCE_CAP_THRESHOLD);
  });

  it("preserves arithmetic score when it is already below the cap", () => {
    const model = createConfidenceModel();
    // baseScore=1 + penalty=-0.7 = 0.3, below the 0.5 cap
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "system", confidence_impact: -0.7 }),
      ],
    });

    expect(snapshot.score).toBeCloseTo(0.3, 5);
    expect(snapshot.confidenceSource).toBe("emulated");
  });

  it("clamps arithmetic score into [0, 1] before applying the cap", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "controller", confidence_impact: -5 }),
      ],
    });

    expect(snapshot.score).toBe(0);
    expect(snapshot.band).toBe("low");
    expect(snapshot.confidenceSource).toBe("real");
  });

  it("R2 AC 2.5: snapshot exposes emulated_entry_count for downstream logging", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeEntry({ decided_by: "system" }),
        makeEntry({ decided_by: "system" }),
      ],
    });

    expect(snapshot.emulated_entry_count).toBe(2);
  });
});

// Property P3 — Confidence Monotonicity
// For any gate-log G, adding a `decided_by: "system"` entry to G produces a
// final_score that is ≤ the final_score computed over G alone (never higher).
// Implemented as a deterministic enumeration loop instead of fast-check to
// avoid adding a runtime dependency (per tech.md: no extra runtime framework).
describe("P3: Confidence Monotonicity (R2)", () => {
  function pseudoRandom(seed: number): () => number {
    // Mulberry32 — small, deterministic PRNG (Wikipedia public domain).
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
  }

  it("adding decided_by='system' never increases final_score (100 random cases)", () => {
    const model = createConfidenceModel();
    const rng = pseudoRandom(0xc0ffee);
    let counterexamples = 0;

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const length = 1 + Math.floor(rng() * 20);
      const gates: ConfidenceGateEntry[] = [];
      for (let index = 0; index < length; index += 1) {
        const impact = (rng() - 0.5) * 0.4; // values in [-0.2, 0.2]
        const decided_by_pick = rng();
        const decided_by =
          decided_by_pick < 0.55
            ? ("controller" as const)
            : decided_by_pick < 0.75
              ? ("user" as const)
              : decided_by_pick < 0.95
                ? ("resume-router" as const)
                : ("system" as const);
        gates.push(makeEntry({ decided_by, confidence_impact: impact }));
      }

      const before = model.apply({ baseScore: 1, gates }).score;
      const after = model.apply({
        baseScore: 1,
        gates: [...gates, makeEntry({ decided_by: "system" })],
      }).score;

      if (after > before + 1e-9) {
        counterexamples += 1;
      }
    }

    expect(counterexamples).toBe(0);
  });
});
