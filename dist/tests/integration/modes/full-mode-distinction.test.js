import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
describe("full mode distinction", () => {
    it("keeps ordinary feature work on the light path", async () => {
        const runtime = createPipelineRuntime({
            cwd: process.cwd(),
            codexHome: "/codex-home",
        });
        const result = await runtime.controller.start("build new dashboard");
        expect(result.mode).toBe("full");
        expect(result.type).toBe("Feature");
        expect(result.complexity).toBe("MEDIA");
        expect(result.variant).toBe("implement-light");
        expect(result.proposal.planModeStatus).toBe("skipped");
        expect(result.proposal.designReviewStatus).toBe("skipped");
    });
});
