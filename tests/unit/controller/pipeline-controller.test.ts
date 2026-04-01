import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";

describe("pipeline controller", () => {
  const runtime = createPipelineRuntime({
    cwd: "/repo",
    codexHome: "/codex-home",
  });

  it("parses diagnostic mode from command-like input", async () => {
    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");
    expect(result.mode).toBe("diagnostic");
    expect(result.type).toBe("Audit");
  });

  it("builds a visible proposal before execution", async () => {
    const result = await runtime.controller.start("fix login redirect loop");
    expect(result.proposal.summary).toContain("fix login redirect loop");
    expect(result.proposal.variant).toMatch(/bugfix/);
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });
});
