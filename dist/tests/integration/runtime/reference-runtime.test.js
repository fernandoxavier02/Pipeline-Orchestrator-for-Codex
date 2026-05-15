import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
describe("reference-backed runtime", () => {
    it("does not touch the bundle during runtime construction", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-missing-"));
        const unhandled = [];
        const onUnhandled = (reason) => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);
        try {
            createPipelineRuntime({ cwd: root, codexHome: "/codex-home" });
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(unhandled).toEqual([]);
        }
        finally {
            process.off("unhandledRejection", onUnhandled);
            await rm(root, { recursive: true, force: true });
        }
    });
    it("reads the variant and macro questions from the loaded reference bundle", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-"));
        const sourceRefs = join(process.cwd(), "references");
        const copiedRefs = join(root, "references");
        try {
            await cp(sourceRefs, copiedRefs, { recursive: true });
            await writeFile(join(copiedRefs, "pipelines", "feature-light.md"), `---\nkind: pipeline-profile\nvariant: feature-light\ntype: Feature\ncomplexity: MEDIA\nintensity: light\nbatchSize: 3\nsummary: Feature work with a renamed light variant for runtime verification.\nchecklists:\n  - business-logic\n  - error-handling\n  - input-validation\n---\n# feature-light\nRuntime proof variant.\n`);
            await writeFile(join(copiedRefs, "complexity-matrix.md"), `---\nkind: complexity-matrix\ntypes:\n  - type: Feature\n    light: feature-light\n    heavy: feature-heavy\n  - type: Bug Fix\n    light: bugfix-light\n    heavy: bugfix-heavy\n  - type: Audit\n    light: audit-light\n    heavy: audit-heavy\n  - type: User Story\n    light: user-story-light\n    heavy: user-story-heavy\n  - type: UX Simulation\n    light: ux-sim-light\n    heavy: ux-sim-heavy\n  - type: Spec\n    light: spec-light\n    heavy: spec-heavy\n---\n# Complexity Matrix\nRuntime proof matrix.\n`);
            await writeFile(join(copiedRefs, "gates", "macro-gate-questions.md"), `---\nkind: gate-bank\ngate: macro\nquestions:\n  - What outcome does the runtime bundle now control?\n  - Which bundle-backed profile should be selected?\n---\n# Macro Gate Questions\nRuntime proof bank.\n`);
            const runtime = createPipelineRuntime({ cwd: root, codexHome: "/codex-home" });
            const result = await runtime.controller.start("build new dashboard");
            expect(result.variant).toBe("feature-light");
            expect(result.proposal.variant).toBe("feature-light");
            expect(result.gates[0].questions).toEqual(expect.arrayContaining([
                "What outcome does the runtime bundle now control?",
                "Which bundle-backed profile should be selected?",
            ]));
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("falls back to bundled references when the target workspace bundle is missing", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-missing-"));
        try {
            const runtime = createPipelineRuntime({ cwd: root, codexHome: "/codex-home" });
            const result = await runtime.controller.start("build new dashboard");
            expect(result.variant).toBe("feature-light");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
