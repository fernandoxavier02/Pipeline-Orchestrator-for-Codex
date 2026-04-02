import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createSessionStore } from "../../../src/state/session-store.js";
import { runInformationGate } from "../../../src/gates/information-gate.js";
import { runAdversarialReview } from "../../../src/review/adversarial-review.js";

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
});
