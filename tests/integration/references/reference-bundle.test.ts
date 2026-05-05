import { cp, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadReferenceBundle } from "../../../src/references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "../../../src/references/reference-profiles.js";

describe("reference bundle", () => {
  it("loads the bundle and resolves a named pipeline profile from its variant", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const index = createReferenceProfileIndex(bundle);
    const profile = index.getPipelineProfile("bugfix-heavy");

    expect(Object.keys(bundle.pipelineProfiles)).toHaveLength(14);
    expect(profile.variant).toBe("bugfix-heavy");
    expect(profile.type).toBe("Bug Fix");
    expect(profile.complexity).toBe("COMPLEXA");
    expect(profile.checklists).toEqual(
      expect.arrayContaining(["data-integrity", "error-handling", "input-validation"]),
    );
    expect(bundle.pipelineProfiles["adversarial-light"]).toMatchObject({
      type: "Audit",
      intensity: "light",
      complexity: "MEDIA",
    });
    expect(bundle.pipelineProfiles["adversarial-heavy"]).toMatchObject({
      type: "Audit",
      intensity: "heavy",
      complexity: "COMPLEXA",
    });
    expect(index.getPipelineProfileForRoute("Spec", "light")).toMatchObject({
      variant: "spec-light",
      type: "Spec",
      intensity: "light",
    });
    expect(index.getPipelineProfileForRoute("Spec", "heavy")).toMatchObject({
      variant: "spec-heavy",
      type: "Spec",
      intensity: "heavy",
    });
  });

  it("loads the team registry and exposes the adversarial team composition", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const adversarialHeavy = bundle.teamRegistry.routes.find((route) => route.profile === "adversarial-heavy");
    const adversarialLight = bundle.teamRegistry.routes.find((route) => route.profile === "adversarial-light");

    expect(adversarialHeavy).toMatchObject({
      type: "Audit",
      intensity: "heavy",
      mode: "review-fix",
      parallelGroups: [["adversarial-security-scanner", "adversarial-architecture-critic"]],
    });
    expect(adversarialHeavy?.agents).toEqual(
      expect.arrayContaining([
        "adversarial-review-coordinator",
        "adversarial-security-scanner",
        "adversarial-architecture-critic",
      ]),
    );
    expect(adversarialLight).toMatchObject({
      type: "Audit",
      intensity: "light",
      mode: "review-fix",
      skipInLight: ["adversarial-architecture-critic"],
    });
  });

  it("keeps spec-light aligned with mandatory post-implementation validation", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const specLight = bundle.teamRegistry.routes.find((route) => route.profile === "spec-light");

    expect(specLight?.agents).toEqual(
      expect.arrayContaining(["spec-post-impl-validator"]),
    );
    expect(specLight?.skipInLight).not.toContain("spec-post-impl-validator");
  });

  it("loads gate question banks and checklist selection by touched domain", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const index = createReferenceProfileIndex(bundle);

    expect(index.getGateQuestions("macro")).toEqual(
      expect.arrayContaining([
        "What is the desired outcome?",
        "Which domains are touched?",
        "What could make this change unsafe?",
      ]),
    );
    expect(index.getGateQuestions("micro")).toEqual(
      expect.arrayContaining([
        "Confirm the change has test evidence.",
        "Confirm rollback or recovery remains possible.",
        "Confirm the touched domains are covered by the checklist routing.",
      ]),
    );
    expect(
      index.selectChecklistIdsForTouchedPaths([
        "src/security/prompt-injection-guard.ts",
        "src/state/session-store.ts",
        "src/controller/build-proposal.ts",
      ]),
    ).toEqual(["auth", "business-logic", "data-integrity", "error-handling", "injection"]);
  });

  it("fails fast when a required reference file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));

    try {
      await expect(loadReferenceBundle(root)).rejects.toThrow(
        /complexity-matrix\.md/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads reference files by catalog content instead of hard-coded file names", { timeout: 10000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
    const sourceRefs = join(process.cwd(), "references");
    const copiedRefs = join(root, "references");

    try {
      await cp(sourceRefs, copiedRefs, { recursive: true });
      await rename(
        join(copiedRefs, "pipelines", "implement-heavy.md"),
        join(copiedRefs, "pipelines", "feature-heavy.md"),
      );
      await rename(
        join(copiedRefs, "checklists", "auth.md"),
        join(copiedRefs, "checklists", "access-control.md"),
      );

      const bundle = await loadReferenceBundle(root);
      expect(bundle.pipelineProfiles["implement-heavy"].sourcePath).toContain("feature-heavy.md");
      expect(bundle.checklists.auth.sourcePath).toContain("access-control.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a matrix-backed team route even when the base variant name changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
    const sourceRefs = join(process.cwd(), "references");
    const copiedRefs = join(root, "references");

    try {
      await cp(sourceRefs, copiedRefs, { recursive: true });
      await writeFile(
        join(copiedRefs, "pipelines", "implement-light.md"),
        `---\nkind: pipeline-profile\nvariant: feature-light\ntype: Feature\ncomplexity: MEDIA\nintensity: light\nbatchSize: 3\nsummary: Feature work with a renamed light variant for team-route resolution.\nchecklists:\n  - business-logic\n  - error-handling\n  - input-validation\n---\n# feature-light\nRuntime proof variant.\n`,
      );
      await writeFile(
        join(copiedRefs, "complexity-matrix.md"),
        `---\nkind: complexity-matrix\ntypes:\n  - type: Feature\n    light: feature-light\n    heavy: implement-heavy\n  - type: Bug Fix\n    light: bugfix-light\n    heavy: bugfix-heavy\n  - type: Audit\n    light: audit-light\n    heavy: audit-heavy\n  - type: User Story\n    light: user-story-light\n    heavy: user-story-heavy\n  - type: UX Simulation\n    light: ux-sim-light\n    heavy: ux-sim-heavy\n  - type: Spec\n    light: spec-light\n    heavy: spec-heavy\n---\n# Complexity Matrix\nRuntime proof matrix.\n`,
      );

      const bundle = await loadReferenceBundle(root);
      const index = createReferenceProfileIndex(bundle);
      const route = index.getTeamRoute("feature-light");

      expect(route).toMatchObject({
        type: "Feature",
        intensity: "light",
        mode: "code-changing",
      });
      expect(route.agents).toEqual(
        expect.arrayContaining([
          "feature-vertical-slice-planner",
          "feature-implementer",
          "feature-integration-validator",
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still fails when a sub-routed profile is renamed without updating the team registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
    const sourceRefs = join(process.cwd(), "references");
    const copiedRefs = join(root, "references");

    try {
      await cp(sourceRefs, copiedRefs, { recursive: true });
      await writeFile(
        join(copiedRefs, "pipelines", "adversarial-light.md"),
        `---\nkind: pipeline-profile\nvariant: adversarial-experimental\ntype: Audit\ncomplexity: MEDIA\nintensity: light\nbatchSize: 1\nsummary: Review-fix routing under a renamed sub-route profile.\nchecklists:\n  - business-logic\n  - error-handling\n---\n# adversarial-experimental\nRenamed sub-route variant.\n`,
      );

      await expect(loadReferenceBundle(root)).rejects.toThrow(
        'Team registry references unknown profile "adversarial-light"',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a matrix row that points to the wrong semantic profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
    const sourceRefs = join(process.cwd(), "references");
    const copiedRefs = join(root, "references");

    try {
      await cp(sourceRefs, copiedRefs, { recursive: true });
      await writeFile(
        join(copiedRefs, "complexity-matrix.md"),
        `---\nkind: complexity-matrix\ntypes:\n  - type: Feature\n    light: implement-light\n    heavy: bugfix-heavy\n  - type: Bug Fix\n    light: bugfix-light\n    heavy: bugfix-heavy\n  - type: Audit\n    light: audit-light\n    heavy: audit-heavy\n  - type: User Story\n    light: user-story-light\n    heavy: user-story-heavy\n  - type: UX Simulation\n    light: ux-sim-light\n    heavy: ux-sim-heavy\n---\n# Complexity Matrix\nBroken on purpose for validation.\n`,
      );

      await expect(loadReferenceBundle(root)).rejects.toThrow(
        /Matrix row for "Feature"|bugfix-heavy/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes auth-sensitive session paths to the auth checklist", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const index = createReferenceProfileIndex(bundle);

    expect(index.selectChecklistIdsForTouchedPaths(["src/state/session-store.ts"])).toContain(
      "auth",
    );
  });
});
