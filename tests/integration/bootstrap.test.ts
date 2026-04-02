import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../src/index.js";

describe("bootstrap", () => {
  it("creates a runtime with default directories and mode support", () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/tmp/codex-home",
    });

    expect(runtime.controller).toBeDefined();
    expect(runtime.stateDir).toContain(".codex/pipeline");
    expect(runtime.supportedModes).toEqual(
      expect.arrayContaining(["full", "diagnostic", "continue", "review-only"]),
    );
    expect(runtime.config.buildCommand).toBeDefined();
    expect(runtime.closeout.finalize).toBeDefined();
    expect(runtime.stores.session).toBeDefined();
    expect(runtime.stores.checkpoints).toBeDefined();
    expect("save" in runtime.stores.session).toBe(false);
    expect("save" in runtime.stores.checkpoints).toBe(false);
    expect("gateLog" in runtime.stores).toBe(false);
    expect("confidence" in runtime.stores).toBe(false);
  });
});
