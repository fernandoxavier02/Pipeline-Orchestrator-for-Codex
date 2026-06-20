import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createChangeContract } from "../../../src/controller/plan-mode.js";
import { createExecutorController } from "../../../src/execution/executor-controller.js";

describe("executor parity contract", () => {
  it("returns change contract, parallel metadata, serial fallback, and per-task checkpoint status", async () => {
    const savedCheckpoints: unknown[] = [];
    const savedGateEntries: unknown[] = [];
    const changeContract = createChangeContract({
      affectedFiles: [
        "src/controller/pipeline-controller.ts",
        "src/controller/plan-mode.ts",
        "src/controller/build-proposal.ts",
      ],
      batchSize: 2,
    });
    const controller = createExecutorController({
      preTester: {
        deriveExecutionProof: () => ({
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          tddApproval: "APPROVED",
          redValidation: { status: "approved", reasons: [] },
        }),
      } as any,
      qualityGateRouter: {
        planBatches: () => ({
          batchSize: 2,
          regressionProofs: 2,
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          batches: [
            {
              name: "batch-1",
              tasks: ["src/controller/pipeline-controller.ts", "src/controller/plan-mode.ts"],
              parallel_eligible: true,
              parallel_reason: "file-scope disjoint",
            },
            {
              name: "batch-2",
              tasks: ["src/controller/build-proposal.ts"],
            },
          ],
        }),
      },
      runBatch: async (batch) => ({
        execution: { changedFiles: batch.files },
        review: { status: "approved", findings: [] },
        changedFiles: batch.files,
        verificationEvidence: {
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          evidence: [`${batch.name}: test passed`],
        },
      }) as any,
      checkpointValidator: {
        validateCheckpoints: ({ checkpointName }) => ({
          status: "passed",
          checkpointName,
          consecutiveFailures: 0,
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          coverage: 1,
        }),
      },
      reviewOrchestrator: {
        reviewBatch: async (input) => ({
          status: "approved",
          findings: [],
          receivedChangeContract: input.changeContract,
        }),
      },
      finalAdversarialOrchestrator: async () => ({
        status: "approved",
        finalDecision: "approved",
      }),
    });

    const result = await controller.executeApprovedWork({
      mode: "full",
      complexity: "MEDIA",
      variant: "feature-light",
      tasks: ["src/controller/pipeline-controller.ts", "src/controller/plan-mode.ts", "src/controller/build-proposal.ts"],
      approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
      changeContract,
      stores: {
        checkpoints: {
          save: async (checkpoint) => {
            savedCheckpoints.push(checkpoint);
          },
        },
        gateLog: {
          append: async (entry) => {
            savedGateEntries.push(entry);
          },
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.executionPlan.CHANGE_CONTRACT).toBe(changeContract);
    expect(result.executionPlan.batch_metadata).toEqual([
      expect.objectContaining({
        batch: "batch-1",
        parallel_eligible: true,
        execution_mode: "parallel-eligible-serial-runtime",
      }),
      expect.objectContaining({
        batch: "batch-2",
        parallel_eligible: undefined,
        execution_mode: "serial-fallback",
        warning: "WARN parallel_eligible absent; serial fallback used.",
      }),
    ]);
    expect(savedGateEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gate: "BATCH_LOOP:batch-1:checkpoint",
        decision: "pass",
        evidence_ref: "batch:batch-1:checkpoint",
      }),
      expect.objectContaining({
        gate: "BATCH_LOOP:batch-1:adversarial_review",
        decision: "pass",
        evidence_ref: "batch:batch-1:adversarial_review",
      }),
      expect.objectContaining({
        gate: "BATCH_LOOP:batch-1:fix_loop",
        decision: "pass",
        evidence_ref: "batch:batch-1:fix_loop",
        open_findings: 0,
      }),
    ]));
    expect(result.proof.checkpointEvidence[0]).toMatchObject({
      batchName: "batch-1",
      parallel_eligible: true,
      parallel_execution: false,
      parallel_execution_actual: false,
      execution_mode: "parallel-eligible-serial-runtime",
      per_task_status: [],
      batch_task_projection: [
        {
          task_id: "src/controller/pipeline-controller.ts",
          status: "BATCH_PASS",
          first_failure: null,
          attribution: "batch_projection",
        },
        {
          task_id: "src/controller/plan-mode.ts",
          status: "BATCH_PASS",
          first_failure: null,
          attribution: "batch_projection",
        },
      ],
    });
    expect(savedCheckpoints[0]).toMatchObject({
      name: "batch-1",
      parallel_eligible: true,
      parallel_execution: false,
      parallel_execution_actual: false,
      execution_mode: "parallel-eligible-serial-runtime",
      per_task_status: [],
      batch_task_projection: [
        {
          task_id: "src/controller/pipeline-controller.ts",
          status: "BATCH_PASS",
          first_failure: null,
          attribution: "batch_projection",
        },
        {
          task_id: "src/controller/plan-mode.ts",
          status: "BATCH_PASS",
          first_failure: null,
          attribution: "batch_projection",
        },
      ],
    });
  });

  it("blocks before execution when a batch falls outside CHANGE_CONTRACT", async () => {
    let runBatchCalled = false;
    const changeContract = createChangeContract({
      affectedFiles: ["src/controller/plan-mode.ts"],
      batchSize: 1,
    });
    const controller = createExecutorController({
      preTester: {
        deriveExecutionProof: () => ({
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          tddApproval: "APPROVED",
          redValidation: { status: "approved", reasons: [] },
        }),
      } as any,
      qualityGateRouter: {
        planBatches: () => ({
          batchSize: 1,
          regressionProofs: 1,
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          batches: [
            {
              name: "batch-outside-contract",
              tasks: ["src/controller/pipeline-controller.ts"],
            },
          ],
        }),
      },
      runBatch: async () => {
        runBatchCalled = true;
        return {} as any;
      },
    });

    const result = await controller.executeApprovedWork({
      mode: "full",
      complexity: "MEDIA",
      variant: "feature-light",
      tasks: ["src/controller/pipeline-controller.ts"],
      approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
      changeContract,
    });

    expect(runBatchCalled).toBe(false);
    expect(result).toMatchObject({
      status: "blocked",
      blockedBy: "CHANGE_CONTRACT_SCOPE",
      violation: {
        outsideAllowed: ["src/controller/pipeline-controller.ts"],
      },
    });
  });

  it("blocks malformed batch review output instead of minting PASS batch-loop evidence", async () => {
    const savedGateEntries: unknown[] = [];
    const changeContract = createChangeContract({
      affectedFiles: ["src/controller/plan-mode.ts"],
      batchSize: 1,
    });
    const controller = createExecutorController({
      preTester: {
        deriveExecutionProof: () => ({
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          tddApproval: "APPROVED",
          redValidation: { status: "approved", reasons: [] },
        }),
      } as any,
      qualityGateRouter: {
        planBatches: () => ({
          batchSize: 1,
          regressionProofs: 1,
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          batches: [
            {
              name: "batch-1",
              tasks: ["src/controller/plan-mode.ts"],
            },
          ],
        }),
      },
      runBatch: async (batch) => ({
        execution: { changedFiles: batch.files },
        review: { status: "approved", findings: [] },
        changedFiles: batch.files,
        verificationEvidence: {
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          evidence: ["tests/unit/controller/plan-mode.test.ts"],
        },
      }) as any,
      checkpointValidator: {
        validateCheckpoints: ({ checkpointName }) => ({
          status: "passed",
          checkpointName,
          consecutiveFailures: 0,
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          coverage: 1,
        }),
      },
      reviewOrchestrator: {
        reviewBatch: async () => ({}),
      },
    });

    const result = await controller.executeApprovedWork({
      mode: "full",
      complexity: "MEDIA",
      variant: "feature-light",
      tasks: ["src/controller/plan-mode.ts"],
      approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
      changeContract,
      stores: {
        gateLog: {
          append: async (entry) => {
            savedGateEntries.push(entry);
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      blockedBy: "BATCH_REVIEW_REWORK",
    });
    expect(savedGateEntries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        gate: "BATCH_LOOP:batch-1:adversarial_review",
        decision: "pass",
      }),
      expect.objectContaining({
        gate: "BATCH_LOOP:batch-1:fix_loop",
        decision: "pass",
      }),
    ]));
  });

  it("persists the active CHANGE_CONTRACT for hook scope-lock while executing a batch", async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), "pipeline-change-contract-"));
    const contractPath = join(sessionRoot, "change-contract.json");
    const changeContract = createChangeContract({
      affectedFiles: ["src/controller/plan-mode.ts"],
      batchSize: 1,
    });
    let contractDuringRun: unknown;
    const controller = createExecutorController({
      preTester: {
        deriveExecutionProof: () => ({
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          tddApproval: "APPROVED",
          redValidation: { status: "approved", reasons: [] },
        }),
      } as any,
      qualityGateRouter: {
        planBatches: () => ({
          batchSize: 1,
          regressionProofs: 1,
          approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
          batches: [
            {
              name: "batch-contract-persistence",
              tasks: ["src/controller/plan-mode.ts"],
            },
          ],
        }),
      },
      runBatch: async (batch) => {
        expect(existsSync(contractPath)).toBe(true);
        contractDuringRun = JSON.parse(readFileSync(contractPath, "utf8"));
        return {
          execution: { changedFiles: batch.files },
          review: { status: "approved", findings: [] },
          changedFiles: batch.files,
          verificationEvidence: {
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            evidence: ["tests/unit/controller/plan-mode.test.ts"],
          },
        } as any;
      },
      checkpointValidator: {
        validateCheckpoints: ({ checkpointName }) => ({
          status: "passed",
          checkpointName,
          consecutiveFailures: 0,
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          coverage: 1,
        }),
      },
      reviewOrchestrator: {
        reviewBatch: async () => ({ status: "approved", findings: [] }),
      },
      finalAdversarialOrchestrator: async () => ({
        status: "approved",
        finalDecision: "approved",
      }),
    });

    const result = await controller.executeApprovedWork({
      mode: "full",
      complexity: "MEDIA",
      variant: "feature-light",
      tasks: ["src/controller/plan-mode.ts"],
      approvedScenarios: ["tests/unit/controller/plan-mode.test.ts"],
      changeContract,
      sessionRoot,
      sessionId: "session-contract-persistence",
    });

    expect(result.status).toBe("completed");
    expect(contractDuringRun).toMatchObject({
      allowed_files: ["src/controller/plan-mode.ts"],
      allowed_new_files: [],
      bootstrap: { active: false },
    });
    expect(existsSync(contractPath)).toBe(false);
  });
});
