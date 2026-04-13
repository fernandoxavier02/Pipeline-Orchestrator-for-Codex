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

  it("opens the fix loop when the per-batch independent review blocks the batch", async () => {
    const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
      if (role === "pre-tester") {
        return {
          mode: "single-agent",
          role: "pre-tester",
          output: {
            PRE_TESTER_RESULT: "approved-proof",
            STATUS: "approved",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "proceed-to-batch",
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            tddApproval: "APPROVED",
            redValidation: {
              status: "approved",
              reasons: ["RED validation passed for approved scenarios"],
            },
          },
        };
      }

      if (role === "checkpoint-validator") {
        return {
          mode: "single-agent",
          role: "checkpoint-validator",
          output: {
            CHECKPOINT_RESULT: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            STATUS: "passed",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "continue",
            status: "passed",
            checkpointName: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            consecutiveFailures: 0,
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            coverage: 1,
            evidence: ["tests/unit/controller/pipeline-controller.test.ts"],
          },
        };
      }

      return {
        mode: "single-agent",
        role: "executor-fix",
        output: {
          status: "attempted",
        },
      };
    });
    const controller = createExecutorController({
      runBatch: vi.fn().mockResolvedValue({
        execution: {
          status: "implemented",
        },
        changedFiles: ["src/controller/pipeline-controller.ts"],
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        },
        fixAttempts: [false, false, false],
      }),
      reviewOrchestrator: {
        reviewBatch: vi.fn().mockResolvedValue({
          status: "blocked",
          findings: [
            {
              severity: "important",
              summary: "Independent batch review still sees an unsafe state transition.",
              file: "src/controller/pipeline-controller.ts",
            },
          ],
        }),
      } as any,
      runRole,
      preTester: {
        deriveExecutionProof: () => ({
          approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
          tddApproval: "APPROVED",
          redValidation: {
            status: "approved",
            reasons: [],
          },
          checkpointEvidence: [],
          fixAttempts: [],
        }),
      } as any,
    });

    const result = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      mode: "--complexa",
      proposal: {
        summary: "stabilize login flow",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
    });

    expect(result.status).toBe("FIX_LOOP_EXHAUSTED");
    expect(result.attempts).toBe(3);
    expect(result.strategyChangeRequired).toBe(true);
    expect(result.batchReview).toEqual(
      expect.objectContaining({
        status: "blocked",
      }),
    );
    const executorFixCalls = runRole.mock.calls.filter(([request]) => request.role === "executor-fix");
    expect(runRole).toHaveBeenCalledTimes(5);
    expect(executorFixCalls).toHaveLength(3);
    expect(executorFixCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        mode: "single-agent",
        role: "executor-fix",
        authorityLevel: "executor",
        filesInScope: ["src/controller/pipeline-controller.ts"],
      }),
    );
  });

  it("uses executor-spec-reviewer and quality-reviewer outputs as direct rework input for executor-fix", async () => {
    const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
      if (role === "pre-tester") {
        return {
          mode: "single-agent",
          role: "pre-tester",
          output: {
            PRE_TESTER_RESULT: "approved-proof",
            STATUS: "approved",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "proceed-to-batch",
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            tddApproval: "APPROVED",
            redValidation: {
              status: "approved",
              reasons: ["RED validation passed for approved scenarios"],
            },
          },
        };
      }

      if (role === "checkpoint-validator") {
        return {
          mode: "single-agent",
          role: "checkpoint-validator",
          output: {
            CHECKPOINT_RESULT: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            STATUS: "passed",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "continue",
            status: "passed",
            checkpointName: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            consecutiveFailures: 0,
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            coverage: 1,
            evidence: ["tests/unit/controller/pipeline-controller.test.ts"],
          },
        };
      }

      return {
        mode: "single-agent",
        role: "executor-fix",
        output: {
          status: "attempted",
        },
      };
    });
    const controller = createExecutorController({
      runBatch: vi.fn().mockResolvedValue({
        execution: {
          status: "implemented",
        },
        changedFiles: ["src/controller/pipeline-controller.ts"],
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        },
        fixAttempts: [false, false, false],
      }),
      reviewOrchestrator: {
        reviewBatch: vi.fn().mockResolvedValue({
          status: "blocked",
          findings: [],
          reviews: [
            {
              reviewer: "executor-spec-reviewer",
              status: "blocked",
              findings: [
                {
                  severity: "important",
                  summary: "Spec reviewer found missing requirement coverage for rollback handling.",
                  file: "src/controller/pipeline-controller.ts",
                },
              ],
            },
            {
              reviewer: "quality-reviewer",
              status: "blocked",
              findings: [
                {
                  severity: "minor",
                  summary: "Quality reviewer found missing regression evidence for continue mode.",
                  file: "src/controller/pipeline-controller.ts",
                },
              ],
            },
          ],
        }),
      } as any,
      runRole,
    });

    await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      mode: "--complexa",
      proposal: {
        summary: "stabilize login flow",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
    });

    const executorFixCalls = runRole.mock.calls.filter(([request]) => request.role === "executor-fix");
    expect(executorFixCalls).toHaveLength(3);
    expect(executorFixCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          findings: expect.arrayContaining([
            expect.objectContaining({
              summary: "Spec reviewer found missing requirement coverage for rollback handling.",
            }),
            expect.objectContaining({
              summary: "Quality reviewer found missing regression evidence for continue mode.",
            }),
          ]),
        }),
      }),
    );
  });

  it("treats a structured executor-fix success result as authoritative and exits the loop early", async () => {
    const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
      if (role === "pre-tester") {
        return {
          mode: "single-agent",
          role: "pre-tester",
          output: {
            PRE_TESTER_RESULT: "approved-proof",
            STATUS: "approved",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "proceed-to-batch",
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            tddApproval: "APPROVED",
            redValidation: {
              status: "approved",
              reasons: ["RED validation passed for approved scenarios"],
            },
          },
        };
      }

      if (role === "checkpoint-validator") {
        return {
          mode: "single-agent",
          role: "checkpoint-validator",
          output: {
            CHECKPOINT_RESULT: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            STATUS: "passed",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "continue",
            status: "passed",
            checkpointName: typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1",
            consecutiveFailures: 0,
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            coverage: 1,
            evidence: ["tests/unit/controller/pipeline-controller.test.ts"],
          },
        };
      }

      return {
        mode: "single-agent",
        role: "executor-fix",
        output: {
          FIX_RESULT: "fixed",
          CHANGES: ["src/controller/pipeline-controller.ts"],
          TESTS: ["tests/unit/controller/pipeline-controller.test.ts"],
          NEXT_ACTION: "re-run-checkpoint",
          status: "fixed",
        },
      };
    });
    const controller = createExecutorController({
      runBatch: vi.fn().mockResolvedValue({
        execution: {
          status: "implemented",
        },
        changedFiles: ["src/controller/pipeline-controller.ts"],
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        },
        fixAttempts: [false, false, false],
      }),
      reviewOrchestrator: {
        reviewBatch: vi.fn().mockResolvedValue({
          status: "blocked",
          findings: [
            {
              severity: "important",
              summary: "Independent batch review still sees an unsafe state transition.",
              file: "src/controller/pipeline-controller.ts",
            },
          ],
        }),
      } as any,
      runRole,
    });

    const result = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      mode: "--complexa",
      proposal: {
        summary: "stabilize login flow",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
    });

    const executorFixCalls = runRole.mock.calls.filter(([request]) => request.role === "executor-fix");
    expect(executorFixCalls).toHaveLength(1);
    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("BATCH_REVIEW_REWORK");
  });
});
