import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collectMarkdownFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("local .agents skill surface", () => {
  it("does not expose the legacy Claude Agent/Task dispatch contract", () => {
    const skillsRoot = join(process.cwd(), ".agents", "skills");
    expect(existsSync(skillsRoot)).toBe(true);
    expect(statSync(skillsRoot).isDirectory()).toBe(true);

    const markdownFiles = collectMarkdownFiles(skillsRoot);
    expect(markdownFiles.length).toBeGreaterThan(0);

    for (const file of markdownFiles) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/\bAgent\s*\(/u);
      expect(content, file).not.toMatch(/\bTask\s*\(/u);
      expect(content, file).not.toMatch(/allowed-tools:.*\bTask\b/u);
    }
  });

  it("keeps the public local entrypoints on real Codex spawn_agent", () => {
    const expectedEntrypoints = ["pipeline", "audit", "bugfix", "feature", "review", "spec"];

    for (const skillName of expectedEntrypoints) {
      const skillPath = join(process.cwd(), ".agents", "skills", skillName, "SKILL.md");
      const content = readFileSync(skillPath, "utf8");
      expect(content, skillPath).toContain("spawn_agent");
      expect(content, skillPath).toContain("PIPELINE_AGENT_FQN");
      expect(content, skillPath).toContain("blocked-no-agent-runtime");
    }
  });
});
