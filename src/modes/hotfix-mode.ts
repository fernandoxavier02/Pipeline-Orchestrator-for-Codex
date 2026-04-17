import type { ReductionPolicy } from "./mode-types.js";

// Ported 1:1 from CC pipeline-orchestrator v3.8.0 commands/pipeline.md:265-287
// HOTFIX Mode (Emergency Bypass): reduces scope but maintains safety.
export function hotfixReductionPolicy(): ReductionPolicy {
  return {
    infoGate: "blocker-only",
    userConfirmation: {
      questions: 1,
      kind: "emergency-confirmation",
    },
    tdd: {
      minimumTests: 1,
      regressionOnly: true,
    },
    adversarialChecklists: ["auth", "injection"],
    sanity: {
      runBuild: true,
      runTests: true,
      runFullRegression: false,
    },
    paDeCal: "standard",
    batchSize: 1,
    forcedClassification: {
      type: "Bug Fix",
      complexity: "COMPLEXA",
      severity: "Critical",
    },
  };
}
