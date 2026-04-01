import { describe, expect, it } from "vitest";
import { resumePipeline } from "../../../src/continue/resume-pipeline.js";

describe("resume pipeline", () => {
  it("resumes from the last safe checkpoint", async () => {
    const result = await resumePipeline({
      session: {
        sessionId: "session-1",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.82,
      },
      checkpoints: [{ name: "phase-2-batch-1", status: "completed" }],
    });

    expect(result.resumeFrom).toBe("phase-2-batch-1");
    expect(result.nextPhase).toBe("phase-2");
  });
});
