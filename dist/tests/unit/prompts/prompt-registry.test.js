import { describe, expect, it } from "vitest";
import { createPromptRegistry } from "../../../src/prompts/prompt-registry.js";
describe("prompt registry", () => {
    it("loads the information gate prompt from disk", async () => {
        const registry = createPromptRegistry(process.cwd());
        const prompt = await registry.load("core/information-gate");
        expect(prompt).toContain("Ask one question at a time");
    });
});
