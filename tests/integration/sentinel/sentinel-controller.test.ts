import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
import { createSentinelStateStore } from "../../../src/sentinel/sentinel-state.js";

describe("sentinel controller integration", () => {
  it("persists sentinel state and records the post_orchestrator checkpoint after intake", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-sentinel-controller-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
        gateLog: createGateLog(root),
        sentinel: createSentinelStateStore(root),
      },
    });

    await controller.start("/pipeline --complexa harden audit trail");

    const sentinelState = await createSentinelStateStore(root).load();
    const gateEntries = await createGateLog(root).list();

    expect(sentinelState).toMatchObject({
      pipelineActive: true,
      currentPhase: "phase-1",
      currentAgent: "pipeline-controller",
      expectedNext: ["proposal-response"],
      lastCheckpoint: "post_orchestrator",
    });
    expect(gateEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "SENTINEL_CHECKPOINT",
          decision: "pass",
          detail: expect.stringContaining("post_orchestrator"),
        }),
      ]),
    );
  });

  it("blocks proposal confirmation when sentinel expectedNext does not allow it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-sentinel-block-"));
    const sessionStore = createSessionStore(root);
    const checkpointStore = createCheckpointStore(root);
    const sentinelStore = createSentinelStateStore(root);
    const controller = createPipelineController({
      stores: {
        session: sessionStore,
        checkpoints: checkpointStore,
        sentinel: sentinelStore,
      },
    });

    await sessionStore.save({
      sessionId: "sentinel-block-session",
      currentPhase: "phase-1",
      phase: "phase-1",
      batchIndex: 0,
      mode: "--complexa",
      variant: "audit-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "harden audit trail",
        variant: "audit-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "partial",
        planModeStatus: "required",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });
    await sentinelStore.save({
      pipelineActive: true,
      currentPhase: "phase-1",
      currentAgent: "pipeline-controller",
      expectedNext: ["continue"],
      completedPhases: ["phase-0"],
      gateSummary: ["INFO_GATE_OK"],
      batchState: {
        batchIndex: 0,
        status: "awaiting-proposal-confirmation",
      },
      consecutiveCorrections: 0,
      lastCheckpoint: "post_orchestrator",
      updatedAt: "2026-04-12T10:00:00.000Z",
    });

    await expect(controller.start("Yes")).rejects.toThrow(/Sentinel blocked unexpected input/i);
  });
});
