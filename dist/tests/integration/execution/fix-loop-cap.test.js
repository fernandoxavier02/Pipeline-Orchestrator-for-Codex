import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createExecutorController } from "../../../src/execution/executor-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
describe("fix loop cap", () => {
    it("surfaces FIX_LOOP_EXHAUSTED through orchestrated execution after three failed fix attempts", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-fix-loop-"));
        const runBatch = vi.fn().mockResolvedValue({
            execution: {
                status: "implemented",
            },
            changedFiles: ["src/controller/pipeline-controller.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: ["tests/fabricated/missing-fix-loop-proof.test.ts"],
            },
            fixAttempts: [false, false, false],
        });
        const sessionStore = createSessionStore(root);
        await sessionStore.save({
            sessionId: "session-fix-loop",
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "--complexa",
            variant: "bugfix-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "stabilize login flow",
                variant: "bugfix-heavy",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "required",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                batchSize: 1,
                validationIntent: "standard",
            },
            approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
            },
            executionProof: {
                approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                fixAttempts: [],
            },
            unresolvedBlockers: [],
            touchedFiles: ["src/controller/pipeline-controller.ts"],
        });
        const controller = createPipelineController({
            stores: {
                session: sessionStore,
                checkpoints: createCheckpointStore(root),
                gateLog: createGateLog(root),
                confidence: createConfidenceScoreStore(root),
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        const firstResult = await controller.start("/pipeline continue");
        const secondResult = await controller.start("/pipeline continue");
        expect(runBatch).toHaveBeenCalledTimes(1);
        expect(firstResult.status).toBe("FIX_LOOP_EXHAUSTED");
        expect(firstResult.attempts).toBe(3);
        expect(firstResult.strategyChangeRequired).toBe(true);
        expect(secondResult.resumeBlocked).toBe(true);
        expect(secondResult.rollbackGate).toBe("FIX_LOOP_EXHAUSTED");
        expect(secondResult.rollbackRoute).toBe("stop");
    });
});
