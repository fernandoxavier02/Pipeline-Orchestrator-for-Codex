import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const COMMAND_PATH = join(__dirname, "..", "..", "commands", "pipeline.md");

function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("No frontmatter found");
  return parseYaml(match[1]) as Record<string, unknown>;
}

describe("commands/pipeline.md frontmatter", () => {
  const content = readFileSync(COMMAND_PATH, "utf8");
  const fm = extractFrontmatter(content);
  const tools = String(fm["allowed-tools"] ?? "")
    .split(",")
    .map((t) => t.trim());

  it("declares the Codex-native subset of tools used by the CC controller", () => {
    // Tools the CC controller uses that have native Codex equivalents
    const required = ["Task", "Read", "Write", "Bash", "Glob", "Grep", "TodoWrite", "Skill"];
    for (const tool of required) {
      expect(tools).toContain(tool);
    }
  });

  it("documents emulated primitives in the body (AskUserQuestion, PlanMode)", () => {
    // Codex has no native EnterPlanMode/ExitPlanMode/AskUserQuestion — they live in src/primitives/
    expect(content).toMatch(/primitives\/ask-user-question/);
    expect(content).toMatch(/primitives\/plan-mode/);
  });
});
