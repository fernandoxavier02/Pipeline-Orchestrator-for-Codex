// tests/bdd/hotfix.feature.test.ts
// BDD scenarios for HOTFIX mode reduction policy.
// Source of truth: CC pipeline-orchestrator v3.8.0 commands/pipeline.md:280-287.
import { describe, it, expect } from "vitest";
import { hotfixReductionPolicy } from "../../src/modes/hotfix-mode.js";

describe("Feature: HOTFIX mode reduces validation scope while preserving safety", () => {
  describe("Scenario: info-gate is reduced to BLOCKER only", () => {
    it("Given HOTFIX mode When asking the policy Then info-gate is BLOCKER-only", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.infoGate).toBe("blocker-only");
    });
  });

  describe("Scenario: user confirmation collapses to 1 emergency question", () => {
    it("Given HOTFIX mode Then userConfirmation is 1 emergency question", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.userConfirmation).toEqual({
        questions: 1,
        kind: "emergency-confirmation",
      });
    });
  });

  describe("Scenario: TDD requires exactly one regression test", () => {
    it("Given HOTFIX mode Then TDD has minimumTests = 1 and regressionOnly = true", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.tdd).toEqual({ minimumTests: 1, regressionOnly: true });
    });
  });

  describe("Scenario: adversarial review runs only auth + injection checklists", () => {
    it("Given HOTFIX mode Then adversarial checklists are exactly auth and injection", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.adversarialChecklists).toEqual(["auth", "injection"]);
    });
  });

  describe("Scenario: sanity check runs build + tests (no full regression)", () => {
    it("Given HOTFIX mode Then sanity is build+tests, no full regression", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.sanity).toEqual({
        runBuild: true,
        runTests: true,
        runFullRegression: false,
      });
    });
  });

  describe("Scenario: final validator (Pa de Cal) is NOT reduced", () => {
    it("Given HOTFIX mode Then paDeCal remains standard GO/NO-GO", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.paDeCal).toBe("standard");
    });
  });

  describe("Scenario: batch size is forced to 1 for maximum control", () => {
    it("Given HOTFIX mode Then batchSize is 1", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.batchSize).toBe(1);
    });
  });

  describe("Scenario: classification is forced to Bug Fix / COMPLEXA / Critical", () => {
    it("Given HOTFIX mode Then classification is forced", () => {
      const policy = hotfixReductionPolicy();
      expect(policy.forcedClassification).toEqual({
        type: "Bug Fix",
        complexity: "COMPLEXA",
        severity: "Critical",
      });
    });
  });
});
