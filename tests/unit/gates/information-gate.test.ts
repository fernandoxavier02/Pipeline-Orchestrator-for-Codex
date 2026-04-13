import { describe, expect, it } from "vitest";
import { runInformationGate } from "../../../src/gates/information-gate.js";

describe("information gate", () => {
  it("blocks when reproduction steps are required for a bugfix", () => {
    const result = runInformationGate({
      request: "fix checkout timeout",
      classification: { type: "Bug Fix", complexity: "MEDIA" },
      knownFacts: [],
    });

    expect(result.status).toBe("blocked");
    expect(result.questions[0]).toContain("reproduction");
  });

  it("prepends an audit scoping question before the macro gate bank for audits", () => {
    const result = runInformationGate({
      request: "audit auth boundary review",
      classification: { type: "Audit", complexity: "COMPLEXA" },
      knownFacts: [],
      referenceIndex: {
        getGateQuestions: () => [
          "What is the desired outcome?",
          "Which domains are touched?",
        ],
      } as any,
    });

    expect(result.status).toBe("passed");
    expect(result.questions).toEqual([
      "Which systems, assets, or trust boundaries are in scope for this audit?",
      "What is the desired outcome?",
      "Which domains are touched?",
    ]);
  });
});
