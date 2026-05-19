import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

type Frontmatter = Record<string, unknown>;

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listMarkdownFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function extractFrontmatter(path: string): Frontmatter {
  const content = readText(path);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) {
    throw new Error(`No frontmatter found in ${relative(ROOT, path)}`);
  }
  return parseYaml(match[1]) as Frontmatter;
}

function toolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((tool) => tool.trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function hasTool(value: unknown, expectedTool: string): boolean {
  return toolList(value).includes(expectedTool);
}

describe("Feature: governed routes require real spawn_agent runtime", () => {
  const skillFiles = listMarkdownFiles(join(ROOT, "skills")).filter((file) => file.endsWith("SKILL.md"));
  const stepFiles = listMarkdownFiles(join(ROOT, "skills", ""))
    .filter((file) => relative(ROOT, file).includes(`${join("steps", "")}`));

  it("Given a skill is allowed to spawn agents Then it fails loudly when spawn_agent is unavailable", () => {
    const governedSkills = skillFiles.filter((file) => hasTool(extractFrontmatter(file)["allowed-tools"], "spawn_agent"));

    expect(governedSkills.length, "test setup should find governed skills").toBeGreaterThan(1);

    for (const file of governedSkills) {
      const body = readText(file);
      const label = relative(ROOT, file);

      expect(body, `${label} must expose the blocked runtime outcome`).toContain("blocked-no-agent-runtime");
      expect(body, `${label} must forbid inline continuation when real spawn_agent is absent`)
        .toMatch(/do not continue inline|never continue inline|must not continue inline/i);
    }
  });

  it("Given a step declares execution_mode subagent Then it declares the dispatch target for the parent", () => {
    const subagentSteps = stepFiles.filter((file) => extractFrontmatter(file).execution_mode === "subagent");

    expect(subagentSteps.length, "test setup should find subagent steps").toBeGreaterThan(1);

    for (const file of subagentSteps) {
      const frontmatter = extractFrontmatter(file);

      expect(
        String(frontmatter.agent_type ?? "").trim(),
        `${relative(ROOT, file)} declares execution_mode: subagent and must declare agent_type`,
      ).not.toBe("");
    }
  });

  it("Given a governed implementation step needs adversarial review Then it does not allow inline fallback review", () => {
    const specLightImplementation = join(ROOT, "skills", "spec-light", "steps", "03-implementation.md");
    const body = readText(specLightImplementation);

    expect(body).not.toMatch(/ou inline se n(?:a|ã)o houver agentes adversariais configurados/i);
    expect(body).not.toMatch(/or inline if no adversarial agents are configured/i);
    expect(body).toContain("spawn_agent");
  });
});
