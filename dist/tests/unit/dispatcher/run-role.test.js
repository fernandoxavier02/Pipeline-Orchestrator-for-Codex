import { describe, expect, it } from "vitest";
import { runRole } from "../../../src/dispatcher/run-role.js";
describe("runRole", () => {
    it("defaults to single-agent emulation mode", async () => {
        const result = await runRole({
            mode: "single-agent",
            role: "information-gate",
            prompt: "Ask one question at a time.",
            input: { request: "fix auth callback" },
        });
        expect(result.mode).toBe("single-agent");
        expect(result.role).toBe("information-gate");
    });
});
