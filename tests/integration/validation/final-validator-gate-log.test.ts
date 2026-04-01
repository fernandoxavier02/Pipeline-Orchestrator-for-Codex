import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createGateLog } from "../../../src/state/gate-log.js";
import { createGateRegistry } from "../../../src/gates/gate-registry.js";
import { createConfidenceModel } from "../../../src/gates/confidence-model.js";

describe("gate log validation", () => {
  it("persists the full SSOT gate log schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gate-log-"));
    const gateLog = createGateLog(root);

    await gateLog.append({
      gate: "STALE_CONTEXT",
      hardness: "SOFT",
      phase: "continue",
      decision: "skip",
      decided_by: "controller",
      timestamp: "2026-04-01T12:00:00.000Z",
      detail: "Run is old but user may still continue after revalidation",
      confidence_impact: -0.1,
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    expect(raw).toContain('"gate":"STALE_CONTEXT"');
    expect(raw).toContain('"confidence_impact":-0.1');

    const entries = await gateLog.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gate: "STALE_CONTEXT",
      hardness: "SOFT",
      phase: "continue",
      decision: "skip",
      decided_by: "controller",
      timestamp: "2026-04-01T12:00:00.000Z",
      detail: "Run is old but user may still continue after revalidation",
      confidence_impact: -0.1,
    });
  });

  it("reduces confidence when a SOFT gate is skipped", () => {
    const registry = createGateRegistry();
    const model = createConfidenceModel();

    const result = model.apply({
      baseScore: 0.9,
      gates: [
        {
          gate: "ADVERSARIAL_GATE",
          hardness: registry.get("ADVERSARIAL_GATE").hardness,
          phase: "phase-2",
          decision: "skip",
          decided_by: "user",
          timestamp: "2026-04-01T12:00:00.000Z",
          detail: "User skipped optional adversarial review",
          confidence_impact: registry.get("ADVERSARIAL_GATE").confidenceImpactOnSkip,
        },
      ],
    });

    expect(result.score).toBeCloseTo(0.75);
    expect(result.band).toBe("medium");
    expect(result.gate_penalty).toBeCloseTo(-0.15);
  });
});
