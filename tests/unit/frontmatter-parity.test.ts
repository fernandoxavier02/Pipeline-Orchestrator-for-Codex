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

  it("declares the Codex-native operational dispatch tool", () => {
    const required = ["update_plan", "spawn_agent", "wait_agent"];
    for (const tool of required) {
      expect(tools).toContain(tool);
    }
    expect(tools).not.toContain("Task");
    expect(tools).not.toContain("AskUserQuestion");
  });

  it("documents Codex parent protocol primitives in the body", () => {
    expect(content).toContain("GATE_REQUEST v1");
    expect(content).toContain("PLAN_MODE_REQUEST v1");
    expect(content).not.toMatch(/EnterPlanMode|ExitPlanMode/);
  });
});
