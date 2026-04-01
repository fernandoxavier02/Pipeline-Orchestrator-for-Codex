import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";

describe("persistence write validation", () => {
  it("rejects partial confidence snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-confidence-"));
    const confidence = createConfidenceScoreStore(root);

    await expect(confidence.save(0.72)).rejects.toThrow();
  });

  it("rejects incomplete checkpoint writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-checkpoints-"));
    const checkpoints = createCheckpointStore(root);

    await expect(checkpoints.save({
      name: "phase-2-batch-1",
      status: "completed",
    } as never)).rejects.toThrow();
  });
});
