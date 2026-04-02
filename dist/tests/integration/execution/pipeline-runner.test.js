import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
describe("pipeline execution", () => {
    it("builds batches, runs review, and returns a closeout summary", async () => {
        const runtime = createPipelineRuntime({
            cwd: process.cwd(),
            codexHome: "/codex-home",
        });
        const result = await runtime.controller.start("implement audit-friendly continue mode");
        expect(result.proposal.awaitingUserConfirmation).toBe(true);
    });
    it("runs a batch through adversarial review and final validation", async () => {
        const { buildBatches } = await import("../../../src/execution/build-batches.js");
        const { runAdversarialReview } = await import("../../../src/review/adversarial-review.js");
        const { runFinalValidator } = await import("../../../src/validation/final-validator.js");
        const batches = buildBatches({
            files: ["src/controller/pipeline-controller.ts", "src/state/session-store.ts"],
        });
        const review = await runAdversarialReview({
            batch: batches[0],
            findings: [],
        });
        const final = runFinalValidator({
            reviews: [review],
            confidenceScore: 0.91,
            gateLog: [],
            verificationEvidence: [
                { kind: "build", passed: true, label: "npm run build" },
                { kind: "tests", passed: true, label: "npm test" },
                { kind: "final-review", passed: true, label: "final adversarial review" },
            ],
            validationIntent: "standard",
        });
        expect(final.decision).toBe("GO");
    });
    it("consults the validated executor prompt file in the runtime dispatcher path", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-executor-prompt-"));
        try {
            await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
            await writeFile(join(root, "prompts", "agents", "executor", "executor-implementer.md"), `# Executor Implementer

Implement only the current batch.
`, "utf8");
            const runtime = createPipelineRuntime({
                cwd: root,
                codexHome: "/codex-home",
            });
            await expect(runtime.dispatcher.runRole({
                mode: "single-agent",
                role: "executor-implementer",
                prompt: "inline executor prompt should not be trusted",
                input: {
                    batch: {
                        name: "batch-1",
                        files: ["src/index.ts"],
                    },
                },
            })).rejects.toThrow(/required output block|CHANGES|TESTS|RISKS/i);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("consults the validated reviewer prompt file in the runtime dispatcher path", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-reviewer-prompt-"));
        try {
            await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
            await writeFile(join(root, "prompts", "agents", "quality", "adversarial-reviewer.md"), `# Adversarial Reviewer

Review from fresh context.
`, "utf8");
            const runtime = createPipelineRuntime({
                cwd: root,
                codexHome: "/codex-home",
            });
            await expect(runtime.dispatcher.runRole({
                mode: "single-agent",
                role: "batch-reviewer",
                prompt: "inline reviewer prompt should not be trusted",
                input: {
                    batch: {
                        name: "batch-1",
                        files: ["src/index.ts"],
                    },
                    files: ["src/index.ts"],
                    changedDomains: ["auth"],
                    reviewOnly: true,
                },
                freshContext: true,
                reviewOnly: true,
            })).rejects.toThrow(/required output block|FINDINGS|SEVERITY|EVIDENCE|NEXT_ACTION/i);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
