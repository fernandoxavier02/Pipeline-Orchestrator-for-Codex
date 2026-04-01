import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../src/index.js";

describe("bootstrap", () => {
  it("creates a runtime with default directories and mode support", () => {
    const runtime = createPipelineRuntime({
      cwd: "/tmp/repo",
      codexHome: "/tmp/codex-home",
    });

    expect(runtime.controller).toBeDefined();
    expect(runtime.stateDir).toContain(".codex/pipeline");
    expect(runtime.supportedModes).toEqual(
      expect.arrayContaining(["full", "diagnostic", "continue", "review-only"]),
    );
  });
});
