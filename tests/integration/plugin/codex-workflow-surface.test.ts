import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const PUBLIC_WORKFLOW_SKILLS = [
  "audit",
  "audit-light",
  "audit-heavy",
  "brainstorm",
  "bugfix",
  "bugfix-light",
  "bugfix-heavy",
  "feature",
  "feature-light",
  "feature-heavy",
  "review",
  "spec",
  "spec-light",
  "spec-heavy",
  "spec-audit-only",
];

function readSkill(name: string) {
  return readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
}

function frontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) {
    throw new Error("No frontmatter found");
  }
  return parseYaml(match[1]) as Record<string, unknown>;
}

function tools(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return String(value ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

describe("Codex-native public workflow surface", () => {
  it("keeps public workflow skill frontmatter on Codex-native dispatch primitives", () => {
    for (const skill of PUBLIC_WORKFLOW_SKILLS) {
      const content = readSkill(skill);
      const fm = frontmatter(content);
      const allowedTools = tools(fm["allowed-tools"]);

      expect(allowedTools, `${skill} must be able to dispatch real Codex agents`).toContain("spawn_agent");
      expect(allowedTools, `${skill} must not expose Claude Task tool as a Codex contract`).not.toContain("Task");
      expect(allowedTools, `${skill} must not expose Claude AskUserQuestion tool as a Codex contract`).not.toContain("AskUserQuestion");
      expect(allowedTools, `${skill} must not expose Claude Agent tool as a Codex contract`).not.toContain("Agent");
    }
  });

  it("documents GATE_REQUEST parent handling instead of direct Claude AskUserQuestion execution", () => {
    for (const skill of PUBLIC_WORKFLOW_SKILLS) {
      const content = readSkill(skill);

      expect(content, `${skill} must document protocol gate handling`).toContain("GATE_REQUEST");
      expect(content, `${skill} must not instruct Codex to invoke Claude AskUserQuestion directly`)
        .not.toMatch(/invoke AskUserQuestion|call AskUserQuestion|AskUserQuestion\(/i);
    }
  });
});
