/**
 * Spec: pipeline-trust-restoration / R9 — Single Authority for Gate Hardness
 * Covers: R9 AC 9.4, 9.5
 *
 * The static gate-registry.ts entries are the SSOT for gate hardness. The
 * hardness-policy.ts classifyGateHardness() utility is the dynamic classifier
 * for runtime (blocker, severity) inputs (used in information-gate.ts).
 *
 * These tests assert that:
 *   (a) the registry only emits valid GateHardness enum values;
 *   (b) the registry's (defaultDecision, hardness) combinations are internally
 *       consistent — e.g. a gate marked "block" with `defaultDecision = "skip"`
 *       would be a bug because it cannot actually block;
 *   (c) classifyGateHardness reproduces each canonical hardness when given
 *       the (blocker, severity) inputs the registry implies.
 */

import { describe, expect, it } from "vitest";
import { createGateRegistry } from "../../../src/gates/gate-registry.js";
import { classifyGateHardness } from "../../../src/gates/hardness-policy.js";
import type { GateHardness } from "../../../src/gates/gate-types.js";

const VALID_HARDNESS: ReadonlySet<GateHardness> = new Set([
  "MANDATORY",
  "HARD",
  "CIRCUIT_BREAKER",
  "SOFT",
  "AUDIT",
]);

describe("R9: Gate Hardness Registry Consistency", () => {
  it("R9 AC 9.5: every registry entry exposes a deterministic, valid hardness", () => {
    const registry = createGateRegistry();
    const allEntries = registry.list();

    expect(allEntries.length).toBeGreaterThan(0);
    for (const entry of allEntries) {
      expect(VALID_HARDNESS.has(entry.hardness)).toBe(true);
      // Determinism: a repeated lookup returns the same hardness object.
      expect(registry.get(entry.gate).hardness).toBe(entry.hardness);
    }
  });

  it("R9 AC 9.4: MANDATORY gates default to 'block' (a non-blocking MANDATORY entry is a registry bug)", () => {
    const registry = createGateRegistry();
    const inconsistent = registry
      .list()
      .filter((entry) => entry.hardness === "MANDATORY" && entry.defaultDecision !== "block");
    expect(inconsistent).toEqual([]);
  });

  it("R9 AC 9.4: classifyGateHardness is consistent with the registry's hardness families", () => {
    expect(classifyGateHardness({ blocker: true, severity: "high" })).toBe("MANDATORY");
    expect(classifyGateHardness({ blocker: true, severity: "medium" })).toBe("HARD");
    expect(classifyGateHardness({ blocker: false, severity: "high" })).toBe("CIRCUIT_BREAKER");
    expect(classifyGateHardness({ blocker: false, severity: "medium" })).toBe("SOFT");
    expect(classifyGateHardness({ blocker: false, severity: "low" })).toBe("SOFT");
  });

  it("hardness-policy.ts is documented as demoted (AUTHORITY_NOTE present)", async () => {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      "src/gates/hardness-policy.ts",
      "utf8",
    );
    // Match either the explicit DEMOTED label or the spec slug.
    expect(content).toMatch(/DEMOTED|pipeline-trust-restoration/);
    expect(content).toMatch(/gate-registry\.ts/);
  });
});
