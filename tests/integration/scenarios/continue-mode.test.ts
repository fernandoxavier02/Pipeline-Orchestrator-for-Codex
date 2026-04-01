import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("continue mode", () => {
  it("refuses to continue while proposal confirmation is pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await createSessionStore(root).save({
      sessionId: "legacy-session-1",
      currentPhase: "phase-1",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "harden audit trail",
        variant: "audit-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });
    await createCheckpointStore(root).save({ name: "plan", status: "completed" });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "Cannot continue while proposal confirmation is pending",
    );
  });

  it("rejects a fabricated phase-1.5 session without controller proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await createSessionStore(root).save({
      sessionId: "fabricated-session-1",
      currentPhase: "phase-1.5",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "harden audit trail",
        variant: "audit-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });
    await createCheckpointStore(root).save({ name: "plan", status: "completed" });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "phase-1.5 session is missing controller-managed transition proof",
    );
  });
});
