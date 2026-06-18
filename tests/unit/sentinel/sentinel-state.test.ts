import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSentinelStateStore } from "../../../src/sentinel/sentinel-state.js";

describe("sentinel state store", () => {
  const originalPipelineIntegrityHmacKey = process.env.PIPELINE_INTEGRITY_HMAC_KEY;
  const originalPipelineSentinelHmacKey = process.env.PIPELINE_SENTINEL_HMAC_KEY;

  function restoreHmacEnv() {
    if (originalPipelineIntegrityHmacKey === undefined) {
      delete process.env.PIPELINE_INTEGRITY_HMAC_KEY;
    } else {
      process.env.PIPELINE_INTEGRITY_HMAC_KEY = originalPipelineIntegrityHmacKey;
    }
    if (originalPipelineSentinelHmacKey === undefined) {
      delete process.env.PIPELINE_SENTINEL_HMAC_KEY;
    } else {
      process.env.PIPELINE_SENTINEL_HMAC_KEY = originalPipelineSentinelHmacKey;
    }
  }

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

  it("signs sentinel state when HMAC integrity is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-sentinel-signed-"));
    const store = createSentinelStateStore(root);
    process.env.PIPELINE_SENTINEL_HMAC_KEY = "sentinel-test-key";

    try {
      await store.save({
        pipelineActive: true,
        currentPhase: "phase-1",
        currentAgent: "pipeline-controller",
        expectedNext: ["proposal-response"],
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
    } finally {
      restoreHmacEnv();
    }

    const parsed = JSON.parse(readFileSync(join(root, "sentinel-state.json"), "utf8"));
    expect(parsed._integrity).toMatchObject({
      algorithm: "hmac-sha256",
    });
    expect(typeof parsed._integrity.signature).toBe("string");
    const loaded = await store.load();
    expect(loaded.expectedNext).toEqual(["proposal-response"]);
  });

  it("signs sentinel state with the shared integrity HMAC key when no sentinel-specific key is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-sentinel-shared-key-"));
    const store = createSentinelStateStore(root);
    delete process.env.PIPELINE_SENTINEL_HMAC_KEY;
    process.env.PIPELINE_INTEGRITY_HMAC_KEY = "shared-integrity-test-key";

    try {
      await store.save({
        pipelineActive: true,
        currentPhase: "phase-1",
        currentAgent: "pipeline-controller",
        expectedNext: ["proposal-response"],
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
    } finally {
      restoreHmacEnv();
    }

    const parsed = JSON.parse(readFileSync(join(root, "sentinel-state.json"), "utf8"));
    expect(parsed._integrity).toMatchObject({
      algorithm: "hmac-sha256",
    });
    expect(typeof parsed._integrity.signature).toBe("string");
  });
});
