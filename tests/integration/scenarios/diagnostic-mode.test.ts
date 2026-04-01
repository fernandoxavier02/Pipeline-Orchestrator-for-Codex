import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";

describe("diagnostic mode", () => {
  it("stops after proposal and marks the run as non-executing", async () => {
    const runtime = createPipelineRuntime({
      cwd: "/repo",
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");

    expect(result.mode).toBe("diagnostic");
    expect(result.stoppedAfterProposal).toBe(true);
  });
});
