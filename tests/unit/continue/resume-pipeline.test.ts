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

  it("falls back to the current phase when closeout is resumed without a completed checkpoint", async () => {
    const result = await resumePipeline({
      session: {
        sessionId: "session-closeout",
        currentPhase: "phase-3",
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.91,
      },
      checkpoints: [],
    });

    expect(result.resumeFrom).toBe("phase-3");
    expect(result.nextPhase).toBe("phase-3");
  });
});
