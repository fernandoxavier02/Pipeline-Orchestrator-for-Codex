// tests/unit/modes/hotfix-skill-doc.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(__dirname, "..", "..", "..", "skills", "pipeline", "SKILL.md");

describe("skills/pipeline/SKILL.md HOTFIX documentation", () => {
  const content = readFileSync(SKILL_PATH, "utf8");

  it("contains the HOTFIX reduction table with all 6 rows", () => {
    // Each row in the table documents one policy dimension.
    const requiredRows = [
      "Info-Gate",
      "User confirm",
      "TDD",
      "Adversarial",
      "Sanity",
      "Pa de Cal",
    ];
    for (const row of requiredRows) {
      expect(content).toContain(row);
    }
  });

  it("clarifies that HOTFIX does NOT skip validation", () => {
    expect(content).toMatch(/HOTFIX does NOT skip validation/i);
  });

  it("references the typed reduction policy", () => {
    expect(content).toContain("src/modes/hotfix-mode.ts");
  });
});
