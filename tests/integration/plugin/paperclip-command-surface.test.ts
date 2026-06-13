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

const paperclipSkillSlugs = paperclipCommands.map((commandFile) => commandFile.replace(/\.md$/u, ""));

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

  it("exposes every Paperclip command shim as a public plugin skill", async () => {
    for (const slug of paperclipSkillSlugs) {
      const content = await readFile(path.join(repoRoot, "skills", slug, "SKILL.md"), "utf8");

      expect(content, slug).toContain(`name: ${slug}`);
      expect(content, slug).toContain(`/pipeline-orchestrator-for-codex:${slug}`);
      expect(content, slug).toContain(`../../commands/${slug}.md`);
      expect(content, slug).toContain("discoverable plugin entrypoint");
      expect(content, slug).toContain("blocked-no-agent-runtime");
      expect(content, slug).toContain("PIPELINE_AGENT_FQN");
    }
  });
});
