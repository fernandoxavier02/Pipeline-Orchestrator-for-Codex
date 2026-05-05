import { describe, expect, it } from "vitest";
import { applyClassificationOverrides } from "../../../src/controller/classification-overrides.js";
import { classifyRequest } from "../../../src/controller/classify-request.js";
import { orchestratorDecisionSchema } from "../../../src/domain/pipeline-schemas.js";

describe("spec classification", () => {
  it("routes spec requests to spec-light by default", () => {
    const result = classifyRequest("criar spec para fluxo de pagamento");
    expect(result.variant).toBe("spec-light");
    expect(result.type).toBe("Spec");
  });

  it("routes complex spec requests to spec-heavy", () => {
    const result = classifyRequest("spec complexa de arquitetura cross-cutting");
    expect(result.variant).toBe("spec-heavy");
  });

  it("routes audit-only spec requests to spec-audit-only", () => {
    const result = classifyRequest("spec audit-only para revisão adversarial");
    expect(result.variant).toBe("spec-audit-only");
    expect(result.type).toBe("Spec");
  });

  it.each([
    ["--complexa", "spec-heavy"],
    ["--media", "spec-light"],
    ["--simples", "spec-light"],
    ["--hotfix", "spec-light"],
  ] as const)("preserves spec lifecycle gates under %s force mode", (mode, expectedVariant) => {
    const classification = classifyRequest("criar spec para fluxo de pagamento");
    const result = applyClassificationOverrides(mode, classification);

    expect(result.classification.variant).toBe(expectedVariant);
    expect(result.classification.variant.startsWith("spec-")).toBe(true);
    expect(result.classification.type).toBe("Spec");
  });

  it("accepts Spec as a public orchestrator decision type", () => {
    expect(orchestratorDecisionSchema.parse({
      mode: "full",
      type: "Spec",
      complexity: "MEDIA",
      variant: "spec-light",
      summary: "Spec flow.",
      affectedFiles: [".kiro/specs/fluxo-pagamento/requirements.md"],
    }).type).toBe("Spec");
  });
});
