import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
  "pipeline",
  "review",
  "spec",
  "spec-light",
  "spec-heavy",
  "spec-audit-only",
];

const GOVERNED_SKILL_FRONTMATTER_KEYS = new Set([
  "agent_type",
  "allowed-tools",
  "argument-hint",
  "description",
  "disable-model-invocation",
  "gates_at",
  "license",
  "metadata",
  "name",
  "report_only",
  "sentinel_checkpoints",
  "sequence",
  "sequence_lock",
  "stop_rule_max_failures",
]);

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

function walkMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      return walkMarkdown(fullPath);
    }
    return entry.endsWith(".md") ? [fullPath] : [];
  });
}

function relativeToRoot(path: string) {
  return relative(ROOT, path).replaceAll("\\", "/");
}

describe("Codex-native public workflow surface", () => {
  it("locks governed SKILL.md frontmatter to the repo-local profile", () => {
    const skillFiles = walkMarkdown(join(ROOT, "skills")).filter((file) => file.endsWith("SKILL.md"));
    let governedFieldCount = 0;

    for (const file of skillFiles) {
      const content = readFileSync(file, "utf8");
      const fm = frontmatter(content);
      const label = relativeToRoot(file);

      expect(String(fm.name ?? ""), `${label} must declare a skill name`).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(String(fm.description ?? "").trim(), `${label} must declare a non-empty description`).not.toBe("");

      for (const key of Object.keys(fm)) {
        expect(GOVERNED_SKILL_FRONTMATTER_KEYS, `${label} has an unsupported frontmatter key: ${key}`).toContain(key);
        if (!["allowed-tools", "description", "license", "metadata", "name"].includes(key)) {
          governedFieldCount += 1;
        }
      }
    }

    expect(governedFieldCount, "test must prove governed skills use fields beyond generic skill-creator validation").toBeGreaterThan(0);
  });

  it("keeps public workflow skill frontmatter on Codex-native dispatch primitives", () => {
    for (const skill of PUBLIC_WORKFLOW_SKILLS) {
      const content = readSkill(skill);
      const fm = frontmatter(content);
      const allowedTools = tools(fm["allowed-tools"]);

      expect(allowedTools, `${skill} must be able to open the visible Codex plan`).toContain("update_plan");
      expect(allowedTools, `${skill} must be able to dispatch real Codex agents`).toContain("spawn_agent");
      expect(allowedTools, `${skill} must be able to wait for spawned Codex agents`).toContain("wait_agent");
      expect(allowedTools, `${skill} must be able to continue spawned Codex agents`).toContain("send_input");
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

  it("ATDD: every spawn-capable governed skill fails closed when real agents are unavailable", () => {
    const skillFiles = walkMarkdown(join(ROOT, "skills")).filter((file) => file.endsWith("SKILL.md"));

    for (const file of skillFiles) {
      const content = readFileSync(file, "utf8");
      const fm = frontmatter(content);
      const allowedTools = tools(fm["allowed-tools"]);
      if (!allowedTools.includes("spawn_agent")) continue;

      const label = relativeToRoot(file);
      expect(content, `${label} must expose the real-agent blocker`).toContain("blocked-no-agent-runtime");
      expect(content, `${label} must forbid inline subagent emulation`).toMatch(/Do not continue inline/i);
      expect(content, `${label} must require pipeline FQN markers`).toContain("PIPELINE_AGENT_FQN");
    }
  });

  it("BDD: subagent step frontmatter declares a concrete dispatch target", () => {
    const stepFiles = walkMarkdown(join(ROOT, "skills")).filter((file) =>
      relative(ROOT, file).split(sep).includes("steps"),
    );

    expect(stepFiles.length, "test setup should find skill step files").toBeGreaterThan(0);

    for (const file of stepFiles) {
      const content = readFileSync(file, "utf8");
      const fm = frontmatter(content);
      if (fm.execution_mode !== "subagent") continue;

      expect(String(fm.agent_type ?? "").trim(), `${relativeToRoot(file)} must declare agent_type`).not.toBe("");
    }
  });

  it("TDD regression: workflow docs do not fall back to inline adversarial review when agents are missing", () => {
    const files = [...walkMarkdown(join(ROOT, "skills")), ...walkMarkdown(join(ROOT, "agents"))];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const label = relativeToRoot(file);

      expect(content, `${label} must not permit inline fallback when adversarial agents are missing`).not.toMatch(
        /inline se n(?:a|ã)o houver agentes/i,
      );
      expect(content, `${label} must not teach direct legacy Agent({ subagent_type }) invocations`).not.toMatch(
        /Agent\(\s*\{\s*subagent_type/i,
      );
      expect(content, `${label} must not instruct use of the legacy Agent tool`).not.toMatch(
        /Use Agent tool with|Spawning tool:\s*Agent only/i,
      );
      expect(content, `${label} must not describe legacy capital-A Agent calls`).not.toMatch(
        /(?:^|[^_])Agent calls/,
      );
    }
  });
});
