import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const paperclipCommands = [
  "paperclip-audit.md",
  "paperclip-bugfix.md",
  "paperclip-feature.md",
  "paperclip-hotfix.md",
  "paperclip-overview.md",
  "paperclip-review.md",
  "paperclip-spec.md",
  "paperclip-user-story.md",
  "paperclip-ux.md",
  "setup-paperclip.md",
];

describe("Paperclip command surface", () => {
  it("ships every Paperclip command under the Codex namespace", async () => {
    for (const commandFile of paperclipCommands) {
      const content = await readFile(path.join(repoRoot, "commands", commandFile), "utf8");

      expect(content, commandFile).toContain("/pipeline-orchestrator-for-codex:");
      expect(content, commandFile).not.toContain("/pipeline-orchestrator:");
    }
  });

  it("keeps Paperclip commands governed by the native Codex capability gate", async () => {
    for (const commandFile of paperclipCommands) {
      const content = await readFile(path.join(repoRoot, "commands", commandFile), "utf8");

      expect(content, commandFile).toContain("Codex governance guard");
      expect(content, commandFile).toContain("CAPABILITY_GATE");
      expect(content, commandFile).toContain("blocked-no-agent-runtime");
      expect(content, commandFile).toContain("parent-owned protocol boundary");
    }
  });
});
