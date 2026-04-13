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
    it("fans out multi-agent requests and aggregates reviewer findings", async () => {
        const result = await runRole({
            mode: "multi-agent",
            role: "final-adversarial-orchestrator",
            prompt: "coordinate the final adversarial team",
            input: {
                scope: {
                    files: ["src/payments/checkout.ts"],
                },
            },
            filesInScope: ["src/payments/checkout.ts"],
            authorityLevel: "controller",
            team: [
                {
                    role: "security-reviewer",
                    prompt: "security pass",
                    input: {
                        files: ["src/payments/checkout.ts"],
                        changedDomains: ["payment"],
                    },
                    filesInScope: ["src/payments/checkout.ts"],
                    authorityLevel: "reviewer",
                    reviewOnly: true,
                },
                {
                    role: "architecture-reviewer",
                    prompt: "architecture pass",
                    input: {
                        files: ["src/payments/checkout.ts"],
                        changedDomains: ["payment"],
                    },
                    filesInScope: ["src/payments/checkout.ts"],
                    authorityLevel: "reviewer",
                    reviewOnly: true,
                },
            ],
            reviewOnly: true,
            freshContext: true,
        });
        expect(result.mode).toBe("multi-agent");
        expect(result.output.status).toBe("blocked");
        expect(result.output.agents).toHaveLength(2);
        expect(result.output.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reviewer: "security-reviewer",
            }),
            expect.objectContaining({
                reviewer: "architecture-reviewer",
            }),
        ]));
    });
});
