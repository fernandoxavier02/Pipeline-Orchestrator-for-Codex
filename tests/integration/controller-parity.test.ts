// tests/integration/controller-parity.test.ts
// Parity check: skill MUST document every gate from gate-registry.ts
// and every rollback path mentioned in the CC v3.8.0 controller.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(__dirname, "..", "..", "skills", "pipeline", "SKILL.md");
const GATE_REGISTRY_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "gates",
  "gate-registry.ts",
);

describe("skills/pipeline/SKILL.md controller parity", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  const registry = readFileSync(GATE_REGISTRY_PATH, "utf8");

  it("documents every gate name from gate-registry.ts", () => {
    // Extract gate keys from the registry (pattern: `  GATE_NAME: {`)
    const gateMatches = Array.from(registry.matchAll(/^\s{2}([A-Z_]+):\s*\{/gm));
    const gateNames = gateMatches.map((m) => m[1]);
    expect(gateNames.length).toBeGreaterThanOrEqual(15);

    // For each gate, skill must reference it at least once.
    const missing = gateNames.filter((g) => !skill.includes(g));
    expect(missing).toEqual([]);
  });

  it("documents phase rollback paths (2→1.5 and 3→2)", () => {
    expect(skill).toMatch(/Phase 2.*Phase 1\.5/s);
    expect(skill).toMatch(/Phase 3.*Phase 2/s);
  });

  it("declares the anti-prompt-injection invariants inline", () => {
    expect(skill).toMatch(/ANTI-PROMPT-INJECTION/i);
    expect(skill).toMatch(/controller-only writes/i);
  });

  it("references the gate decision log format (JSONL)", () => {
    expect(skill).toMatch(/GATE_DECISION_LOG/);
    expect(skill).toMatch(/JSONL/);
  });
});
