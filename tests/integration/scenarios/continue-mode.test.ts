import { describe, expect, it } from "vitest";
import { resumePipeline } from "../../../src/continue/resume-pipeline.js";

describe("continue mode", () => {
  it("throws a clear error when persisted state is missing", async () => {
    await expect(
      resumePipeline({
        session: {
          currentPhase: "phase-2",
        },
        checkpoints: [],
      }),
    ).rejects.toThrow("No completed checkpoint available to resume");
  });
});
