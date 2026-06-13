import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const fixturePath = join(repoRoot, "tests", "compat", "wave6b-paperclip-scenarios.json");

type CompatibilityScenario = {
  id: string;
  family: string;
  prompt: string;
  expectedTemplate: { type: string; variant: string | null };
  mode: string;
  requiredEvidence: string[];
};

type Fixture = {
  claimBoundary: string;
  scenarios: CompatibilityScenario[];
};

type BddScenario = {
  id: string;
  given: string;
  when: string;
  then: string;
  deterministicFixture: string;
};

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

function scenarioToBdd(scenario: CompatibilityScenario): BddScenario {
  return {
    id: `bdd-${scenario.id}`,
    given: `Given a maintainer requests the ${scenario.family} Paperclip workflow`,
    when: `When the request says "${scenario.prompt}"`,
    then: [
      `Then the repo-only parity evidence points to the ${scenario.expectedTemplate.type} template`,
      `and the workflow mode is ${scenario.mode}`,
      `and deterministic fixture ${scenario.id} remains the source of truth`,
    ].join(" "),
    deterministicFixture: scenario.id,
  };
}

describe("Feature: Wave 6B Paperclip BDD parity mirrors deterministic compatibility fixtures", () => {
  it("Given Wave 6B compatibility scenarios When converted to BDD Then every family has a natural-language scenario", () => {
    const fixture = loadFixture();
    const bddScenarios = fixture.scenarios.map(scenarioToBdd);

    expect(fixture.claimBoundary).toContain("repo-only compatibility fixture");
    expect(new Set(bddScenarios.map((scenario) => scenario.deterministicFixture))).toEqual(
      new Set(fixture.scenarios.map((scenario) => scenario.id)),
    );

    for (const scenario of bddScenarios) {
      expect(scenario.given, scenario.id).toMatch(/^Given /);
      expect(scenario.when, scenario.id).toMatch(/^When /);
      expect(scenario.then, scenario.id).toMatch(/^Then /);
      expect(scenario.then, scenario.id).toContain("repo-only parity evidence");
      expect(scenario.then, scenario.id).toContain("deterministic fixture");
    }
  });

  it("Given a BDD scenario exists Then it keeps at least two concrete evidence expectations from the fixture", () => {
    const fixture = loadFixture();

    for (const scenario of fixture.scenarios) {
      const bddScenario = scenarioToBdd(scenario);

      expect(bddScenario.deterministicFixture).toBe(scenario.id);
      expect(scenario.requiredEvidence.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(bddScenario.then, scenario.id).toContain(scenario.expectedTemplate.type);
      expect(bddScenario.then, scenario.id).toContain(scenario.mode);
    }
  });
});
