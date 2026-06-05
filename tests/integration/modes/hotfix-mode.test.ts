import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createPipelineRuntime } from "../../../src/index.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
import { runInformationGate } from "../../../src/gates/information-gate.js";
import { runAdversarialReview } from "../../../src/review/adversarial-review.js";
import { REQUIRED_PIPELINE_GATES } from "../../../src/governance/pipeline-contract.js";

describe("hotfix mode", () => {
  it("forces a reduced-validation bug fix path and narrows execution to one regression proof", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-hotfix-"));
    const executionController = {
      executeApprovedWork: vi.fn().mockResolvedValue({
        status: "completed",
        execution: {
          batchSize: 1,
          regressionProofs: 1,
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
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
      executionController,
    });

    const result = await controller.start("/pipeline --hotfix patch login session leak");

    expect(result.mode).toBe("--hotfix");
    expect(result.type).toBe("Bug Fix");
    expect(result.complexity).toBe("COMPLEXA");
    expect(result.variant).toBe("bugfix-heavy");
    expect(result.proposal.validationIntent).toBe("reduced");
    expect(result.proposal.batchSize).toBe(1);

    await controller.start("Yes");
    await controller.start("Yes");

    const executionResult = await controller.start("/pipeline continue");

    expect(executionController.executeApprovedWork).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: expect.objectContaining({
          validationIntent: "reduced",
          batchSize: 1,
        }),
      }),
    );
    expect(executionResult.execution.batchSize).toBe(1);
    expect(executionResult.execution.regressionProofs).toBe(1);
  });

  it("narrows the macro information gate to blocker questions during hotfix intake", () => {
    const referenceIndex = {
      getGateQuestions: vi.fn().mockReturnValue([
        "What architecture changes are expected?",
        "Which broader rollout steps should be considered?",
      ]),
    };

    const result = runInformationGate({
      request: "patch login session leak",
      classification: { type: "Bug Fix", complexity: "COMPLEXA" },
      knownFacts: [],
      referenceIndex: referenceIndex as any,
      mode: "--hotfix",
    } as any);

    expect(result.status).toBe("blocked");
    expect(result.questions).toEqual([
      "What blocker is this hotfix addressing right now?",
    ]);
  });

  it("restricts hotfix adversarial routing to auth and injection checklists", async () => {
    const result = await runAdversarialReview({
      batch: {
        name: "Hotfix batch",
        files: ["src/auth/session.ts", "src/db/query-builder.ts"],
      },
      findings: [],
      changedFiles: ["src/auth/session.ts", "src/db/query-builder.ts"],
      mode: "--hotfix",
    } as any);

    expect(result.required).toBe(true);
    expect(result.checklists).toEqual(["auth", "injection"]);
  });

  it("reduces final validation to build plus tests and logs reduced validation usage", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-hotfix-closeout-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Authoritative checkpoint proof",
    });
    await createSessionStore(runtime.stateDir).save({
      sessionId: "hotfix-closeout-proof",
      currentPhase: "phase-3",
      phase: "phase-3",
      batchIndex: 0,
      mode: "--hotfix",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      unresolvedBlockers: [],
      touchedFiles: ["src/index.ts"],
      executionProof: {
        approvedScenarios: ["tests/proof/batch-1.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: ["Controller approved RED proof"],
        },
        checkpointEvidence: [
          {
            batchName: "batch-1",
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            evidence: ["tests/proof/batch-1.test.ts"],
          },
        ],
        fixAttempts: [],
      },
    });

    const gateLog = createGateLog(runtime.stateDir);
    for (const gate of REQUIRED_PIPELINE_GATES) {
      await gateLog.append({
        gate,
        hardness: "HARD",
        phase: "phase-3",
        decision: "pass",
        decided_by: "controller",
        timestamp: "2026-04-02T12:00:00.000Z",
        detail: `${gate} passed`,
        confidence_impact: 0,
      });
    }

    const result = await runtime.closeout.finalize({
      mode: "--hotfix",
      validationIntent: "reduced",
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
      ],
      confirmed: true,
    });

    const gateEntries = await gateLog.list();

    expect(result.requiredEvidence).toEqual(["build", "tests"]);
    expect(result.decision).toBe("GO");
    expect(gateEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "REDUCED_VALIDATION_USAGE",
          decision: "pass",
        }),
      ]),
    );
  });
});
