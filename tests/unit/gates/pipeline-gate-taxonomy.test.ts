import { describe, expect, it } from "vitest";
import { REQUIRED_PIPELINE_GATES } from "../../../src/governance/pipeline-contract.js";
import { createGateRegistry } from "../../../src/gates/gate-registry.js";

describe("pipeline gate taxonomy", () => {
  it("DDD: every required pipeline governance gate has a registered blocking or penalized policy", () => {
    const registry = createGateRegistry();

    for (const gate of REQUIRED_PIPELINE_GATES) {
      const definition = registry.get(gate);

      expect(definition.gate).toBe(gate);
      if (definition.hardness === "SOFT") {
        expect(definition.defaultDecision).toBe("skip");
        expect(definition.confidenceImpactOnSkip).toBeLessThan(0);
      } else {
        expect(definition.hardness).toBe("MANDATORY");
        expect(definition.defaultDecision).toBe("block");
      }
    }
  });
});
