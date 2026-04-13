import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSentinelStateStore } from "../../../src/sentinel/sentinel-state.js";

describe("sentinel state store", () => {
  it("persists sentinel state as validated JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-sentinel-"));
    const store = createSentinelStateStore(root);

    await store.save({
      pipelineActive: true,
      currentPhase: "phase-1",
      currentAgent: "pipeline-controller",
      expectedNext: ["proposal-response"],
      completedPhases: ["phase-0"],
      gateSummary: ["INFO_GATE_OK", "DESIGN_INTERROGATION"],
      batchState: {
        batchIndex: 0,
        status: "awaiting-proposal-confirmation",
      },
      consecutiveCorrections: 0,
      lastCheckpoint: "post_orchestrator",
      updatedAt: "2026-04-12T10:00:00.000Z",
    });

    const raw = readFileSync(join(root, "sentinel-state.json"), "utf8");
    expect(raw).toContain("\"lastCheckpoint\":\"post_orchestrator\"");
    const loaded = await store.load();
    expect(loaded.expectedNext).toEqual(["proposal-response"]);
  });
});
