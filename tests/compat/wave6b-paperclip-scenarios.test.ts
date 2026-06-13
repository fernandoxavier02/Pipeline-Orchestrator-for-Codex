import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const fixturePath = join(repoRoot, "tests", "compat", "wave6b-paperclip-scenarios.json");

type Fixture = {
  schemaVersion: number;
  sourceSpec: string;
  canonicalTarget: string;
  codexBaseline: string;
  claimBoundary: string;
  scenarios: Array<{
    id: string;
    family: string;
    taskType: string;
    complexity: "SIMPLES" | "MEDIA" | "COMPLEXA";
    variant: string | null;
    prompt: string;
    command: string;
    skill: string;
    expectedTemplate: { type: string; variant: string | null };
    mode: string;
    requiredEvidence: string[];
  }>;
};

const { classify } = require("../../references/paperclip/spec/lib/classify-bridge.cjs") as {
  classify: (
    description: string,
    override?: { type?: string; complexity?: string },
  ) => { type: string; complexity: string; source: string };
};

const { getTemplate } = require("../../references/paperclip/spec/lib/tree-template.cjs") as {
  getTemplate: (type: string, variant?: string | null) => Array<{ step: string; role: string }>;
};

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

describe("Wave 6B Paperclip compatibility fixtures", () => {
  it("covers the required workflow families with repo-only claim boundaries", () => {
    const fixture = loadFixture();

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.sourceSpec).toBe(".kiro/specs/canonical-v7-portability-closeout");
    expect(fixture.canonicalTarget).toBe("v7.12.0");
    expect(fixture.codexBaseline).toBe("v0.5.0");
    expect(fixture.claimBoundary).toContain("repo-only compatibility fixture");

    expect(new Set(fixture.scenarios.map((scenario) => scenario.family))).toEqual(
      new Set(["audit", "bugfix", "feature", "hotfix", "spec", "user-story", "ux"]),
    );
  });

  it("maps every fixture to an existing command, skill, classifier override, and Paperclip template", () => {
    const fixture = loadFixture();

    for (const scenario of fixture.scenarios) {
      expect(existsSync(join(repoRoot, scenario.command)), scenario.command).toBe(true);
      expect(existsSync(join(repoRoot, scenario.skill)), scenario.skill).toBe(true);
      expect(scenario.requiredEvidence.length, scenario.id).toBeGreaterThanOrEqual(2);

      const classification = classify(scenario.prompt, {
        type: scenario.taskType,
        complexity: scenario.complexity,
      });
      expect(classification, scenario.id).toMatchObject({
        type: scenario.taskType,
        complexity: scenario.complexity,
        source: "override",
      });

      const template = getTemplate(
        scenario.expectedTemplate.type,
        scenario.expectedTemplate.variant,
      );
      expect(template.length, scenario.id).toBeGreaterThan(0);
      expect(template[0], scenario.id).toHaveProperty("step");
      expect(template[0], scenario.id).toHaveProperty("role");
    }
  });
});
