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

describe("checkpoint stop rule", () => {
  it("triggers STOP_RULE through controller and executor orchestration after two failed checkpoint proofs", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-stop-rule-"));
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce({
        execution: {
          status: "implemented",
        },
        changedFiles: [
          "src/controller/pipeline-controller.ts",
          "src/execution/executor-controller.ts",
        ],
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/fabricated/missing-stop-rule-proof.test.ts"],
        },
      })
      .mockResolvedValueOnce({
        execution: {
          status: "implemented",
        },
        changedFiles: [
          "src/controller/pipeline-controller.ts",
          "src/execution/executor-controller.ts",
        ],
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/fabricated/missing-stop-rule-proof.test.ts"],
        },
      });
    const sessionStore = createSessionStore(root);
    await sessionStore.save({
      sessionId: "session-stop-rule",
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
        affectedFiles: [
          "src/controller/pipeline-controller.ts",
          "src/execution/executor-controller.ts",
        ],
        batchSize: 1,
        validationIntent: "standard",
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: [
          "tests/unit/controller/pipeline-controller.test.ts",
          "tests/integration/execution/controller-routing.test.ts",
        ],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: [
        "src/controller/pipeline-controller.ts",
        "src/execution/executor-controller.ts",
      ],
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

    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(firstResult.status).toBe("STOP_RULE");
    expect(firstResult.validation.status).toBe("STOP_RULE");
    expect(secondResult.resumeBlocked).toBe(true);
    expect(secondResult.rollbackGate).toBe("STOP_RULE");
    expect(secondResult.rollbackRoute).toBe("stop");
  });
});
