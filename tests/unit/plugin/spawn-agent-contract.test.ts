import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walkFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path, predicate));
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Codex spawn_agent operational contract", () => {
  const operationalFiles = [
    ...walkFiles(join(ROOT, "skills"), (path) => path.endsWith(".md")),
    ...walkFiles(join(ROOT, ".agents", "skills"), (path) => path.endsWith(".md")),
    join(ROOT, "hooks", "force-pipeline-agents.cjs"),
    join(ROOT, "src", "adapters", "codex-agent-runtime.ts"),
  ];

  it("never instructs governed pipeline dispatch to fork full parent history", () => {
    const offenders = operationalFiles
      .filter((path) => read(path).includes("fork_context: true"))
      .map((path) => relative(ROOT, path));

    expect(offenders).toEqual([]);
  });

  it("pins governed dispatch examples to worker plus fork_context false", () => {
    const required = [
      "skills/pipeline/SKILL.md",
      ".agents/skills/pipeline/SKILL.md",
      "hooks/force-pipeline-agents.cjs",
      "skills/bugfix-heavy/steps/08-adversarial-ux-tech-review.md",
      ".agents/skills/bugfix-heavy/steps/08-adversarial-ux-tech-review.md",
      "skills/spec-audit-only/steps/03-audit-loop.md",
      ".agents/skills/spec-audit-only/steps/03-audit-loop.md",
      "src/adapters/codex-agent-runtime.ts",
    ];

    for (const file of required) {
      const content = read(join(ROOT, file));
      expect(content, file).toContain("fork_context");
      expect(content, file).toContain("false");
    }
  });

  it("does not use malformed slash-separated pipeline FQNs in skill frontmatter", () => {
    const offenders = operationalFiles
      .filter((path) => read(path).includes("pipeline-orchestrator-for-codex:executor/type-specific"))
      .map((path) => relative(ROOT, path));

    expect(offenders).toEqual([]);
  });
});
