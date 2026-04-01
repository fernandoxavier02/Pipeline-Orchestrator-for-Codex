import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("session store", () => {
  it("persists session state as validated JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-state-"));
    const store = createSessionStore(root);

    await store.save({
      sessionId: "session-1",
      currentPhase: "phase-1",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "build new dashboard",
        variant: "implement-light",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "skipped",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 3,
        validationIntent: "standard",
      },
    });

    const raw = readFileSync(join(root, "session.json"), "utf8");
    expect(raw).toContain("\"sessionId\":\"session-1\"");
    const loaded = await store.load();
    expect(loaded.proposal?.summary).toBe("build new dashboard");
  });
});
