import { cp } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("review-only mode", () => {
  it("runs review planning without entering implementation", { timeout: 10000 }, async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    expect(result.mode).toBe("review-only");
    expect(result.implementationSkipped).toBe(true);
  });

  it("does not leave a resumable confirmation session behind", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-review-only-"));
    await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });

    await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    await expect(createSessionStore(runtime.stateDir).load()).rejects.toThrow();
  });
});
