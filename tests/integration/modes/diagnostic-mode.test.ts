import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPipelineRuntime } from "../../../src/index.js";

describe("diagnostic prompt contracts", () => {
  it("fails before controller consumption when a required output block is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-diagnostic-contract-"));

    try {
      await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "controller", "pipeline-controller.md"),
        `# Pipeline Controller

Read repository context before asking questions.
Classify the request, choose the phase route, and return a structured proposal.

Required output block:
- MODE
- TYPE
- COMPLEXITY
- VARIANT
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.controller.start("/pipeline diagnostic audit auth flow")).rejects.toThrow(
        /PROPOSAL|required output block/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
