import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("hotfix mode", () => {
  it("forces a reduced-validation bug fix path and narrows execution to one regression proof", async () => {
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
});
