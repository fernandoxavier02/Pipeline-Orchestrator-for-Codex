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
        expect(Object.keys(bundle.pipelineProfiles)).toHaveLength(10);
        expect(profile.variant).toBe("bugfix-heavy");
        expect(profile.type).toBe("Bug Fix");
        expect(profile.complexity).toBe("COMPLEXA");
        expect(profile.checklists).toEqual(expect.arrayContaining(["data-integrity", "error-handling", "input-validation"]));
    });
    it("loads gate question banks and checklist selection by touched domain", async () => {
        const bundle = await loadReferenceBundle(process.cwd());
        const index = createReferenceProfileIndex(bundle);
        expect(index.getGateQuestions("macro")).toEqual(expect.arrayContaining([
            "What is the desired outcome?",
            "Which domains are touched?",
            "What could make this change unsafe?",
        ]));
        expect(index.getGateQuestions("micro")).toEqual(expect.arrayContaining([
            "Confirm the change has test evidence.",
            "Confirm rollback or recovery remains possible.",
            "Confirm the touched domains are covered by the checklist routing.",
        ]));
        expect(index.selectChecklistIdsForTouchedPaths([
            "src/security/prompt-injection-guard.ts",
            "src/state/session-store.ts",
            "src/controller/build-proposal.ts",
        ])).toEqual(["auth", "business-logic", "data-integrity", "error-handling", "injection"]);
    });
    it("fails fast when a required reference file is missing", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
        try {
            await expect(loadReferenceBundle(root)).rejects.toThrow(/complexity-matrix\.md/i);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("loads reference files by catalog content instead of hard-coded file names", { timeout: 10000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
        const sourceRefs = join(process.cwd(), "references");
        const copiedRefs = join(root, "references");
        try {
            await cp(sourceRefs, copiedRefs, { recursive: true });
            await rename(join(copiedRefs, "pipelines", "implement-heavy.md"), join(copiedRefs, "pipelines", "feature-heavy.md"));
            await rename(join(copiedRefs, "checklists", "auth.md"), join(copiedRefs, "checklists", "access-control.md"));
            const bundle = await loadReferenceBundle(root);
            expect(bundle.pipelineProfiles["implement-heavy"].sourcePath).toContain("feature-heavy.md");
            expect(bundle.checklists.auth.sourcePath).toContain("access-control.md");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("rejects a matrix row that points to the wrong semantic profile", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-refs-"));
        const sourceRefs = join(process.cwd(), "references");
        const copiedRefs = join(root, "references");
        try {
            await cp(sourceRefs, copiedRefs, { recursive: true });
            await writeFile(join(copiedRefs, "complexity-matrix.md"), `---\nkind: complexity-matrix\ntypes:\n  - type: Feature\n    light: implement-light\n    heavy: bugfix-heavy\n  - type: Bug Fix\n    light: bugfix-light\n    heavy: bugfix-heavy\n  - type: Audit\n    light: audit-light\n    heavy: audit-heavy\n  - type: User Story\n    light: user-story-light\n    heavy: user-story-heavy\n  - type: UX Simulation\n    light: ux-sim-light\n    heavy: ux-sim-heavy\n---\n# Complexity Matrix\nBroken on purpose for validation.\n`);
            await expect(loadReferenceBundle(root)).rejects.toThrow(/Matrix row for "Feature"|bugfix-heavy/i);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("routes auth-sensitive session paths to the auth checklist", async () => {
        const bundle = await loadReferenceBundle(process.cwd());
        const index = createReferenceProfileIndex(bundle);
        expect(index.selectChecklistIdsForTouchedPaths(["src/state/session-store.ts"])).toContain("auth");
    });
});
