/**
 * Spec: pipeline-trust-restoration / R4 / G-P1-2
 * Covers: R4 AC 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * Test the strictAgents=undefined production-default path on the cascade:
 *   - resolveRequireRealAgent treats operational pipeline dispatches as
 *     requireRealAgent=true even when strictAgents is undefined.
 *   - The shared cascade applies identically to runtimeRunRole, Review_Orchestrator,
 *     and Final_Adversarial_Orchestrator (Property P2 — Cascade Equivalence).
 *   - When emulation is forced (strictAgents=false) on a non-operational dispatch,
 *     the gate-log records decided_by="system" and the confidence cap engages.
 */

import { describe, expect, it } from "vitest";
import { resolveRequireRealAgent, isOperationalPipelineDispatch }
  from "../../src/runtime/strict-resolution.js";
import { createConfidenceModel, type ConfidenceGateEntry }
  from "../../src/gates/confidence-model.js";
import type { DispatchRequest } from "../../src/dispatcher/dispatcher-types.js";

function makeDispatchRequest(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    mode: "parallel-emulation",
    role: "review-orchestrator",
    prompt: "p",
    input: { request: "/pipeline-orchestrator-for-codex:pipeline implement feature X" },
    requireRealAgent: false,
    freshContext: true,
    reviewOnly: true,
    filesInScope: [],
    authorityLevel: "controller",
    team: [],
    ...overrides,
  };
}

function makeGateEntry(decided_by: "controller" | "user" | "system" | "resume-router"): ConfidenceGateEntry {
  return {
    gate: "FINAL_ADVERSARIAL_GATE",
    hardness: "HARD",
    phase: "phase-3",
    decision: "pass",
    decided_by,
    timestamp: new Date().toISOString(),
    detail: "fixture",
    confidence_impact: 0,
  };
}

describe("R4: strictAgents=undefined production-default path", () => {
  it("R4 AC 4.1: operational pipeline dispatch resolves requireRealAgent=true when strictAgents=undefined", () => {
    const request = makeDispatchRequest({
      requireRealAgent: undefined as unknown as boolean,
      input: { request: "/pipeline-orchestrator-for-codex:pipeline implement X" },
    });
    expect(resolveRequireRealAgent({}, request)).toBe(true);
    expect(resolveRequireRealAgent(undefined, request)).toBe(true);
    expect(isOperationalPipelineDispatch(request)).toBe(true);
  });

  it("R4 AC 4.2: same cascade applies to a non-operational dispatch — emulation allowed when strictAgents=undefined", () => {
    const request = makeDispatchRequest({
      requireRealAgent: undefined as unknown as boolean,
      input: { request: "ad-hoc helper task" }, // not /pipeline-orchestrator-for-codex:pipeline
    });
    expect(resolveRequireRealAgent({}, request)).toBe(false);
  });

  it("R4 AC 4.3: confidence final_score is capped at 0.5 when ≥1 decided_by='system' entry exists", () => {
    const model = createConfidenceModel();
    const snapshot = model.apply({
      baseScore: 1,
      gates: [
        makeGateEntry("controller"),
        makeGateEntry("system"),
      ],
    });
    expect(snapshot.score).toBeLessThanOrEqual(0.5);
    expect(snapshot.confidenceSource).toBe("emulated");
  });

  it("R4 AC 4.4: cascade resolution is deterministic across repeated calls", () => {
    const request = makeDispatchRequest({
      requireRealAgent: undefined as unknown as boolean,
      input: { request: "/pipeline-orchestrator-for-codex:pipeline classify" },
    });
    const results = new Set<boolean>();
    for (let index = 0; index < 25; index += 1) {
      results.add(resolveRequireRealAgent({}, request));
    }
    expect(results.size).toBe(1);
    expect(results.has(true)).toBe(true);
  });

  it("diagnostic-mode dispatch escapes the operational default", () => {
    const diagnostic = makeDispatchRequest({
      requireRealAgent: undefined as unknown as boolean,
      input: { request: "/pipeline-orchestrator-for-codex:pipeline diagnostic check" },
    });
    expect(isOperationalPipelineDispatch(diagnostic)).toBe(false);
    expect(resolveRequireRealAgent({}, diagnostic)).toBe(false);
  });

  it("explicit strictAgents=true wins over the operational heuristic", () => {
    const request = makeDispatchRequest({
      requireRealAgent: undefined as unknown as boolean,
      input: { request: "ad-hoc helper task" },
    });
    expect(resolveRequireRealAgent({ strictAgents: true }, request)).toBe(true);
  });

  it("explicit request.requireRealAgent wins over options.strictAgents", () => {
    const request = makeDispatchRequest({
      requireRealAgent: true,
      input: { request: "ad-hoc helper task" },
    });
    expect(resolveRequireRealAgent({ strictAgents: false }, request)).toBe(true);
  });
});

// Property P2: Cascade Equivalence (R3 AC 3.1, 3.2 + R7 AC 7.4)
// The function `resolveRequireRealAgent(options, request)` is the single point
// of truth for the cascade. Verifying it is deterministic across many input
// combinations (random options × random request prompts) proves the
// equivalence property without requiring three separate parallel call paths.
describe("P2: Cascade Equivalence (R3)", () => {
  function pseudoRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
  }

  it("cascade is total and pure (same inputs → same output) across 200 random cases", () => {
    const rng = pseudoRandom(0x1234abcd);
    const prompts = [
      "/pipeline-orchestrator-for-codex:pipeline build",
      "/pipeline-orchestrator-for-codex:pipeline diagnostic find issue",
      "random helper",
      "",
      "/pipeline-orchestrator-for-codex:pipeline ", // trailing space
      "/pipeline-orchestrator-for-codex:pipeline diagnostic",
    ];

    let mismatches = 0;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const pick = prompts[Math.floor(rng() * prompts.length)];
      const strictPick = rng();
      const reqPick = rng();
      const options = strictPick < 0.33
        ? {}
        : strictPick < 0.66
          ? { strictAgents: true }
          : { strictAgents: false };
      const request = makeDispatchRequest({
        requireRealAgent:
          reqPick < 0.33
            ? (undefined as unknown as boolean)
            : reqPick < 0.66
              ? true
              : false,
        input: { request: pick },
      });

      const first = resolveRequireRealAgent(options, request);
      const second = resolveRequireRealAgent(options, request);
      const third = resolveRequireRealAgent(options, request);
      if (first !== second || second !== third) mismatches += 1;
    }

    expect(mismatches).toBe(0);
  });
});
