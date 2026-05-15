import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadReferenceBundle } from "../../../src/references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "../../../src/references/reference-profiles.js";
import { classifyRequest } from "../../../src/controller/classify-request.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("classifyRequest", () => {
  it("keeps heavy variants aligned with the reference bundle complexity", async () => {
    const bundle = await loadReferenceBundle(repoRoot);
    const index = createReferenceProfileIndex(bundle);

    const cases = [
      { input: "fix checkout timeout", variant: "bugfix-heavy" as const },
      { input: "audit auth flow", variant: "audit-heavy" as const },
      { input: "build new dashboard", variant: "feature-light" as const },
      { input: "story for onboarding flow", variant: "user-story-heavy" as const },
    ];

    for (const testCase of cases) {
      const classification = classifyRequest(testCase.input);
      const profile = index.getPipelineProfile(testCase.variant);

      expect(classification.variant).toBe(testCase.variant);
      expect(classification.complexity).toBe(profile.complexity);
    }
  });

  it("detects adversarial audit intent without discarding the base audit variant", async () => {
    const bundle = await loadReferenceBundle(repoRoot);
    const index = createReferenceProfileIndex(bundle);

    const classification = classifyRequest("run adversarial security audit on auth boundaries", index);

    expect(classification.type).toBe("Audit");
    expect(classification.variant).toBe("audit-heavy");
    expect(classification.routeFamily).toBe("adversarial");
    expect(classification.adversarialRequested).toBe(true);
  });
});
