import { describe, expect, it } from "vitest";
import { hotfixReductionPolicy } from "../../../src/modes/hotfix-mode.js";
import { isReducedValidation, reductionPolicyForMode } from "../../../src/modes/mode-policy.js";
import { planQualityGateBatches } from "../../../src/execution/quality-gate-router.js";
import { resolveAdversarialChecklists, resolveFinalValidationEvidence } from "../../../src/review/domain-checklists.js";
import { runInformationGate } from "../../../src/gates/information-gate.js";

describe("reductionPolicyForMode", () => {
  it("returns the hotfix policy for --hotfix and null for other modes", () => {
    expect(reductionPolicyForMode("--hotfix")).toEqual(hotfixReductionPolicy());
    expect(reductionPolicyForMode("--complexa")).toBeNull();
    expect(reductionPolicyForMode("--simples")).toBeNull();
    expect(reductionPolicyForMode(undefined)).toBeNull();
  });

  it("isReducedValidation respects either mode or explicit validationIntent", () => {
    expect(isReducedValidation({ mode: "--hotfix" })).toBe(true);
    expect(isReducedValidation({ validationIntent: "reduced" })).toBe(true);
    expect(isReducedValidation({ mode: "--complexa", validationIntent: "standard" })).toBe(false);
  });
});

describe("HOTFIX wiring is policy-driven", () => {
  it("quality-gate-router reads batchSize=1 and minimumTests=1 from the policy", () => {
    const plan = planQualityGateBatches({
      complexity: "MEDIA",
      tasks: ["a.ts", "b.ts", "c.ts"],
      mode: "--hotfix",
    });
    expect(plan.batchSize).toBe(hotfixReductionPolicy().batchSize);
    expect(plan.regressionProofs).toBe(hotfixReductionPolicy().tdd.minimumTests);
  });

  it("quality-gate-router does not mark MEDIA batches parallel without disjoint file-scope proof", () => {
    const plan = planQualityGateBatches({
      complexity: "MEDIA",
      tasks: ["src/shared.ts", "src/shared.ts", "src/other.ts"],
    });

    expect(plan.batches[0]).toEqual(
      expect.objectContaining({
        parallel_eligible: false,
        parallel_reason: expect.stringContaining("No validated file-scope proof"),
      }),
    );
  });

  it("adversarial checklists in --hotfix are policy.adversarialChecklists", () => {
    const checklists = resolveAdversarialChecklists({
      files: ["src/billing/charge.ts"],
      mode: "--hotfix",
    });
    expect(checklists).toEqual(hotfixReductionPolicy().adversarialChecklists);
  });

  it("final validation evidence under --hotfix omits final-review (sanity.runFullRegression=false)", () => {
    expect(resolveFinalValidationEvidence({ mode: "--hotfix" })).toEqual(["build", "tests"]);
    expect(resolveFinalValidationEvidence({ validationIntent: "reduced" })).toEqual(["build", "tests"]);
    expect(resolveFinalValidationEvidence({ mode: "--complexa" })).toEqual([
      "build",
      "tests",
      "final-review",
    ]);
  });

  it("information-gate uses policy.infoGate=blocker-only to suppress reference questions on hotfix", () => {
    const result = runInformationGate({
      request: "fix login redirect loop",
      classification: { type: "Bug Fix", complexity: "COMPLEXA" },
      knownFacts: [],
      mode: "--hotfix",
    });
    expect(result.questions).toEqual(["What blocker is this hotfix addressing right now?"]);
  });
});
