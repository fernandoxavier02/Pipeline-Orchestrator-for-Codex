import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";

describe("review-only mode", () => {
  it("runs review planning without entering implementation", async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    expect(result.mode).toBe("review-only");
    expect(result.implementationSkipped).toBe(true);
  });
});
