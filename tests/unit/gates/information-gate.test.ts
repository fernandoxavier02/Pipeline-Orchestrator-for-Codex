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
});
