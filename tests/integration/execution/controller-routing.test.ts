import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createExecutorController } from "../../../src/execution/executor-controller.js";
import { createPreTester } from "../../../src/execution/pre-tester.js";
import { createQualityGateRouter } from "../../../src/execution/quality-gate-router.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("execution controller routing", () => {
  it("blocks execution when TDD approval is missing", async () => {
    const runBatch = vi.fn();
    const controller = createExecutorController({
      runBatch,
      qualityGateRouter: createQualityGateRouter(),
      preTester: createPreTester(),
      checkpointValidator: {
        validateCheckpoints: vi.fn(),
      },
    });

    const result = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      approvedScenarios: [],
      tddApproval: "REJECTED",
      redValidation: {
        status: "blocked",
        reasons: ["approved test scenarios must come first"],
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("TDD_APPROVAL");
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects fabricated approved proof when no controller-owned scenarios were supplied", async () => {
    const runBatch = vi.fn();
    const controller = createExecutorController({
      runBatch,
    });

    const result = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      tddApproval: "APPROVED",
      redValidation: {
        status: "approved",
        reasons: ["fabricated"],
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("TDD_APPROVAL");
    expect(result.proof.approvedScenarios).toEqual([]);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects non-test scenarios as invalid RED proof inputs", async () => {
    const runBatch = vi.fn();
    const controller = createExecutorController({
      runBatch,
    });

    const result = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      approvedScenarios: ["src/controller/pipeline-controller.ts"],
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("TDD_APPROVAL");
    expect(result.proof.approvedScenarios).toEqual([]);
    expect(result.proof.redValidation.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not a real test proof input"),
      ]),
    );
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects red validation when syntax or import failures are present", async () => {
    const tester = createPreTester();

    const result = tester.validateRedState({
      approvedScenarios: ["happy path"],
      failures: [
        {
          kind: "syntax",
          file: "src/execution/run-batch.ts",
          message: "Unexpected token",
        },
        {
          kind: "import",
          file: "src/execution/executor-controller.ts",
          message: "Cannot find module",
        },
      ],
    });

    expect(result.status).toBe("blocked");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("syntax"),
        expect.stringContaining("import"),
      ]),
    );
  });

  it("sizes batches adaptively across the SSOT complexity levels", () => {
    const router = createQualityGateRouter();

    expect(
      router.planBatches({
        complexity: "SIMPLES",
        tasks: ["a", "b", "c"],
      }).batches,
    ).toEqual([
      {
        name: "batch-1",
        tasks: ["a", "b", "c"],
      },
    ]);

    expect(
      router.planBatches({
        complexity: "MEDIA",
        tasks: ["a", "b", "c", "d", "e"],
      }).batches.map((batch) => batch.tasks.length),
    ).toEqual([3, 2]);

    expect(
      router.planBatches({
        complexity: "COMPLEXA",
        tasks: ["a", "b", "c"],
      }).batches.map((batch) => batch.tasks.length),
    ).toEqual([1, 1, 1]);
  });

  it("routes approved work through execution, review, checkpoint, and validation", async () => {
    const executionController = {
      executeApprovedWork: vi.fn().mockResolvedValue({
        status: "completed",
        execution: {
          batchSize: 1,
        },
        review: {
          status: "approved",
        },
        validation: {
          status: "go",
        },
      }),
    };

    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            sessionId: "session-1",
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "full",
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
            unresolvedBlockers: [],
            touchedFiles: ["src/controller/pipeline-controller.ts"],
          }),
        },
        checkpoints: {
          list: async () => [],
        },
      },
      executionController,
    });

    const result = await controller.start("/pipeline continue");

    expect(executionController.executeApprovedWork).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "phase-1.5",
        proposal: expect.objectContaining({
          summary: "stabilize login flow",
        }),
      }),
    );
    expect(result.status).toBe("completed");
    expect(result.review.status).toBe("approved");
    expect(result.validation.status).toBe("go");
  });

  it("advances the real approval flow into execution once controller proof is promoted", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-controller-routing-"));
    const runBatch = vi.fn();
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
      executionController: createExecutorController({
        runBatch,
      }),
    });

    await controller.start("/pipeline --complexa stabilize login flow");
    await controller.start("Yes");
    const planApprovalResult = await controller.start("Yes");
    const approvedSession = await createSessionStore(root).load();
    runBatch.mockResolvedValue({
      status: "completed",
      execution: {
        batchSize: 1,
      },
      review: {
        status: "approved",
      },
      verificationEvidence: {
        scenarios: [approvedSession.executionProof?.approvedScenarios?.[0] ?? ""],
      },
    });
    const continueResult = await controller.start("/pipeline continue");

    expect(planApprovalResult.implementationPlan.status).toBe("APPROVED");
    expect(approvedSession.executionProof).toMatchObject({
      tddApproval: "REJECTED",
      redValidation: {
        status: "blocked",
      },
    });
    expect(approvedSession.executionProof?.approvedScenarios.length).toBeGreaterThan(0);
    expect(
      approvedSession.executionProof?.approvedScenarios.every((scenario) =>
        scenario.startsWith("tests/") && scenario.endsWith(".test.ts")
      ),
    ).toBe(true);
    expect(runBatch).toHaveBeenCalled();
    expect(continueResult.status).toBe("completed");
    expect(continueResult.blockedBy).toBeUndefined();
    expect(continueResult.validation.status).toBe("passed");
  });

  it("uses the runtime-authoritative workspace root instead of process.cwd() for approval and RED proof", async () => {
    const repoRoot = process.cwd();
    const fakeCwd = mkdtempSync(join(tmpdir(), "pipeline-fake-cwd-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "pipeline-controller-workspace-root-"));
    const runBatch = vi.fn();

    try {
      process.chdir(fakeCwd);

      const controller = createPipelineController({
        stores: {
          session: createSessionStore(stateRoot),
          checkpoints: createCheckpointStore(stateRoot),
        },
        executionController: createExecutorController({
          runBatch,
        }),
        workspaceRoot: repoRoot,
      });

      await controller.start("/pipeline --complexa stabilize login flow");
      await controller.start("Yes");
      await controller.start("Yes");
      const approvedSession = await createSessionStore(stateRoot).load();

      runBatch.mockResolvedValue({
        execution: {
          status: "implemented",
        },
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: [approvedSession.executionProof?.approvedScenarios?.[0] ?? ""],
        },
      });

      const continueResult = await controller.start("/pipeline continue");

      expect(approvedSession.executionProof?.approvedScenarios.length).toBeGreaterThan(0);
      expect(continueResult.status).toBe("completed");
      expect(continueResult.validation.status).toBe("passed");
    } finally {
      process.chdir(repoRoot);
    }
  });

  it.each([
    ["No", "REJECTED"],
    ["Adjust", "ADJUSTED"],
  ])("keeps continue blocked after approval is revoked with %s", async (response, status) => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-controller-revoke-"));
    const runBatch = vi.fn();
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
      executionController: createExecutorController({
        runBatch,
      }),
    });

    await controller.start("/pipeline --complexa stabilize login flow");
    await controller.start("Yes");
    await controller.start("Yes");
    const planResult = await controller.start(response);
    const continueResult = await controller.start("/pipeline continue");

    expect(planResult.implementationPlan.status).toBe(status);
    expect(continueResult.status).toBe("blocked");
    expect(continueResult.blockedBy).toBe("TDD_APPROVAL");
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("blocks the real continue path when phase 2 lacks TDD and RED proof", async () => {
    const runBatch = vi.fn();
    let savedSession: Record<string, unknown> | undefined;
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            sessionId: "session-2",
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "full",
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
            pendingDecision: "phase-1.5-approval-required",
            unresolvedBlockers: [],
            touchedFiles: ["src/controller/pipeline-controller.ts"],
          }),
          save: async (session) => {
            savedSession = session as Record<string, unknown>;
          },
        },
        checkpoints: {
          list: async () => [],
          save: async () => undefined,
        },
      },
      executionController: createExecutorController({
        runBatch,
      }),
    });

    const result = await controller.start("/pipeline continue");

    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("TDD_APPROVAL");
    expect(result.phase).toBe("phase-1.5");
    expect(runBatch).not.toHaveBeenCalled();
    expect(savedSession?.currentPhase).toBe("phase-1.5");
  });

  it("rejects fabricated batch-runner verification evidence that is not controller-approved", async () => {
    const runBatch = vi.fn().mockResolvedValue({
      execution: {
        status: "implemented",
      },
      review: {
        status: "approved",
      },
      verificationEvidence: {
        scenarios: ["tests/fabricated/missing-red-proof.test.ts"],
      },
    });
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            sessionId: "session-3",
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
              tddApproval: "APPROVED",
              redValidation: {
                status: "approved",
                reasons: ["fabricated"],
              },
              checkpointEvidence: [
                {
                  batchName: "batch-1",
                  requiredCheckpoints: 1,
                  verifiedCheckpoints: 1,
                  evidence: ["fabricated pass"],
                },
              ],
            },
            unresolvedBlockers: [],
            touchedFiles: ["src/controller/pipeline-controller.ts"],
          }),
          save: async () => undefined,
        },
        checkpoints: {
          list: async () => [],
          save: async () => undefined,
        },
      },
      executionController: createExecutorController({
        runBatch,
      }),
    });

    const result = await controller.start("/pipeline continue");

    expect(runBatch).toHaveBeenCalledOnce();
    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("CHECKPOINT_FAIL");
    expect(result.validation.status).toBe("failed");
    expect(result.validation.coverage).toBe(0);
  });

  it("re-derives approved scenarios on continue instead of trusting a forged persisted scenario list", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-controller-forged-proof-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "tests", "proof"), { recursive: true });
    writeFileSync(join(root, "src", "target.ts"), "export const target = 'target';\n", "utf8");
    writeFileSync(join(root, "src", "other.ts"), "export const other = 'other';\n", "utf8");
    writeFileSync(
      join(root, "tests", "proof", "other.test.ts"),
      "import { describe, expect, it } from 'vitest';\nimport { other } from '../../src/other.js';\n\ndescribe('other proof', () => {\n  it('covers a different file', () => {\n    expect(other).toBe('other');\n  });\n});\n",
      "utf8",
    );

    const sessionStore = createSessionStore(root);
    await sessionStore.save({
      sessionId: "session-forged-proof",
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      batchIndex: 0,
      mode: "--complexa",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "stabilize target flow",
        variant: "bugfix-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/target.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: ["tests/proof/other.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: ["forged"],
        },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/target.ts"],
    });

    const runBatch = vi.fn();
    const controller = createPipelineController({
      workspaceRoot: root,
      stores: {
        session: sessionStore,
        checkpoints: createCheckpointStore(root),
      },
      executionController: createExecutorController({
        runBatch,
      }),
    });

    const result = await controller.start("/pipeline continue");

    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("TDD_APPROVAL");
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("converts a plain checkpoint failure into a deterministic blocked controller outcome", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-controller-checkpoint-fail-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "tests", "proof"), { recursive: true });
    writeFileSync(join(root, "src", "target.ts"), "export const target = 'target';\n", "utf8");
    writeFileSync(
      join(root, "tests", "proof", "target.test.ts"),
      "import { describe, expect, it } from 'vitest';\nimport { target } from '../../src/target.js';\n\ndescribe('target proof', () => {\n  it('covers the target file', () => {\n    expect(target).toBe('target');\n  });\n});\n",
      "utf8",
    );

    const sessionStore = createSessionStore(root);
    await sessionStore.save({
      sessionId: "session-checkpoint-fail",
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      batchIndex: 0,
      mode: "--complexa",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "stabilize target flow",
        variant: "bugfix-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/target.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: [],
        tddApproval: "REJECTED",
        redValidation: {
          status: "blocked",
          reasons: ["RED validation proof is required before implementation"],
        },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/target.ts"],
    });

    const runBatch = vi.fn().mockResolvedValue({
      execution: {
        status: "implemented",
      },
      review: {
        status: "approved",
      },
      verificationEvidence: {
        scenarios: [],
      },
    });
    const controller = createPipelineController({
      workspaceRoot: root,
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

    expect(firstResult.status).toBe("blocked");
    expect(firstResult.blockedBy).toBe("CHECKPOINT_FAIL");
    expect(firstResult.phase).toBe("phase-2");
    expect(firstResult.validation.status).toBe("failed");
    expect(secondResult.resumeBlocked).toBe(true);
    expect(secondResult.rollbackGate).toBe("CHECKPOINT_FAIL");
    expect(secondResult.rollbackRoute).toBe("revalidate");
  });

  it("does not leak checkpoint failure counts across separate executions", async () => {
    const runBatch = vi
      .fn()
      .mockResolvedValue({
        execution: {
          status: "implemented",
        },
        review: {
          status: "approved",
        },
        verificationEvidence: {
          scenarios: ["tests/fabricated/missing-shared-proof.test.ts"],
        },
      });
    const controller = createExecutorController({
      runBatch,
    });

    const firstResult = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
    });
    const secondResult = await controller.executeApprovedWork({
      batch: {
        name: "batch-1",
        files: ["src/controller/pipeline-controller.ts"],
      },
      approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
    });

    expect(firstResult.status).toBe("failed");
    expect(firstResult.validation?.status).toBe("failed");
    expect(secondResult.status).toBe("failed");
    expect(secondResult.validation?.status).toBe("failed");
  });
});
