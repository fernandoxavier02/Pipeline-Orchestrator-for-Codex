import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controllerPath = resolve(".kimi/skills/pipeline/agents/pipeline-controller.md");
const controller = readFileSync(controllerPath, "utf8");

// List of Kimi-compatible tool names that a coder subagent actually has
const KIMI_TOOLS = ["ReadFile", "WriteFile", "Shell", "Glob", "Grep", "StrReplaceFile", "ReadMediaFile"];

// List of Claude-only tool names that do NOT exist in Kimi
const CLAUDE_TOOLS = ["Read", "Write", "Bash", "Task", "AskUserQuestion", "Agent", "EnterPlanMode", "ExitPlanMode", "TodoWrite"];

describe("Batch 1 — C2: Tool names must be Kimi-compatible", () => {
  it("must not reference Claude-only tool names in controller body", () => {
    // Exclude frontmatter block from check
    const body = controller.replace(/^---[\s\S]*?^---/m, "");
    const found: string[] = [];
    for (const tool of CLAUDE_TOOLS) {
      // Match tool names used as inline code, but allow negative-context mentions
      // like "does NOT have `AskUserQuestion`" or "instead of `Agent`"
      const regex = new RegExp(`\\\`${tool}\\\``, "g");
      let match;
      while ((match = regex.exec(body)) !== null) {
        const start = Math.max(0, match.index - 80);
        const end = Math.min(body.length, match.index + 80);
        const context = body.slice(start, end).toLowerCase();
        // Allow if context indicates negation or protocol explanation
        const isNegative = /not have|does not|cannot|do not|instead of|emit .* instead|runtime does not/i.test(context);
        if (!isNegative) {
          found.push(tool);
          break;
        }
      }
    }
    expect(found, `Found Claude-only tools in controller used as instructions (not negated): ${found.join(", ")}`).toEqual([]);
  });

  it("must reference Kimi-native tool names (ReadFile, WriteFile, Shell)", () => {
    const body = controller.replace(/^---[\s\S]*?^---/m, "");
    expect(body).toContain("ReadFile");
    expect(body).toContain("WriteFile");
    expect(body).toContain("Shell");
  });

  it("must not have Claude frontmatter fields (tools, model, color)", () => {
    const frontmatterMatch = controller.match(/^---([\s\S]*?)^---/m);
    expect(frontmatterMatch).toBeTruthy();
    const frontmatter = frontmatterMatch![1];
    expect(frontmatter).not.toContain("tools:");
    expect(frontmatter).not.toContain("model:");
    expect(frontmatter).not.toContain("color:");
  });
});

describe("Batch 1 — H6: DISPATCH_REQUEST schema consistency", () => {
  it("must use target_type (not target_kind) in all DISPATCH_REQUEST blocks", () => {
    const body = controller.replace(/^---[\s\S]*?^---/m, "");
    expect(body).toContain("target_type:");
    expect(body).not.toContain("target_kind:");
  });
});

describe("Batch 1 — L1: Frontmatter cleanup across all skills", () => {
  const skills = [
    ".kimi/skills/pipeline/SKILL.md",
    ".kimi/skills/bugfix/SKILL.md",
    ".kimi/skills/feature/SKILL.md",
    ".kimi/skills/audit/SKILL.md",
    ".kimi/skills/review/SKILL.md",
    ".kimi/skills/spec/SKILL.md",
  ];

  for (const skillPath of skills) {
    const name = skillPath.split("/").slice(-2)[0];
    it(`${name} frontmatter must only contain name and description`, () => {
      const content = readFileSync(resolve(skillPath), "utf8");
      const fmMatch = content.match(/^---([\s\S]*?)^---/m);
      expect(fmMatch).toBeTruthy();
      const fm = fmMatch![1];
      const lines = fm.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
      for (const line of lines) {
        const key = line.split(":")[0].trim();
        expect(["name", "description"], `Unexpected frontmatter key "${key}" in ${skillPath}`).toContain(key);
      }
    });
  }
});

describe("Batch 1 — L4: Descriptions must not mention slash-commands", () => {
  const skills = [
    ".kimi/skills/pipeline/SKILL.md",
    ".kimi/skills/bugfix/SKILL.md",
    ".kimi/skills/feature/SKILL.md",
    ".kimi/skills/audit/SKILL.md",
    ".kimi/skills/review/SKILL.md",
    ".kimi/skills/spec/SKILL.md",
  ];

  for (const skillPath of skills) {
    const name = skillPath.split("/").slice(-2)[0];
    it(`${name} description must not mention slash commands like /pipeline`, () => {
      const content = readFileSync(resolve(skillPath), "utf8");
      const fmMatch = content.match(/^---([\s\S]*?)^---/m);
      expect(fmMatch).toBeTruthy();
      const desc = fmMatch![1];
      expect(desc).not.toMatch(/\s\/\w+/); // no space + slash + word
    });
  }
});
