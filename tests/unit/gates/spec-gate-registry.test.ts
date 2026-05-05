import { describe, expect, it } from "vitest";
import { createGateRegistry } from "../../../src/gates/gate-registry.js";

describe("spec gate registry", () => {
  it("registers the spec lifecycle gates", () => {
    const registry = createGateRegistry();
    expect(registry.get("SPEC_ARTIFACT_MISSING").hardness).toBe("HARD");
    expect(registry.get("SPEC_FORMAT_GATE_FAIL").phase).toBe("phase-1");
    expect(registry.get("SPEC_CONTENT_REVIEW_NOGO").phase).toBe("phase-2");
    expect(registry.get("SPEC_AC_TRACEABILITY_GAP").hardness).toBe("HARD");
    expect(registry.get("ADVERSARIAL_LOOP_CHECKPOINT").hardness).toBe("SOFT");
    expect(registry.get("SPEC_POST_IMPL_FAIL").phase).toBe("phase-3");
  });
});
