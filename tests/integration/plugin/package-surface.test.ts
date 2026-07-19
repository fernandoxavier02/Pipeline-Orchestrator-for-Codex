import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SPEC_TEMPLATE_CONSUMERS = [
  "skills/spec-init/SKILL.md",
  "skills/spec-requirements/SKILL.md",
  "skills/spec-design/SKILL.md",
  "skills/spec-tasks/SKILL.md",
];

function referencedSpecTemplates() {
  return new Set(SPEC_TEMPLATE_CONSUMERS.flatMap((skillPath) => {
    const skill = readFileSync(skillPath, "utf8");
    return [...skill.matchAll(/`(references\/spec-templates\/[^`]+\.(?:json|md))`/gu)]
      .map((match) => match[1])
      .filter((path): path is string => Boolean(path));
  }));
}

function npmPackDryRunFiles() {
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, "pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    : spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
      shell: process.platform === "win32",
    });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  const parsed = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((file) => file.path) ?? [];
}

describe("plugin package surface", () => {
  it("ships compiled governance runtime and excludes external audit reports", { timeout: 30000 }, () => {
    const files = npmPackDryRunFiles();

    expect(files).toContain("dist/src/governance/pipeline-contract.js");
    expect(files).toContain("dist/src/governance/ledger-evidence.js");
    expect(files).toContain("dist/src/governance/workflow-enforcement.js");
    expect(files).toContain("src/governance/ledger-evidence.ts");
    expect(files).toContain("src/governance/workflow-enforcement.ts");
    expect(files.some((file) => file.startsWith("security-audit/"))).toBe(false);
    expect(files.some((file) => file.startsWith("evals/telemetry/"))).toBe(false);
  });

  it("ships every spec template referenced by lifecycle skills", { timeout: 30000 }, () => {
    const files = npmPackDryRunFiles();
    const templatePaths = referencedSpecTemplates();

    expect(templatePaths.size).toBeGreaterThan(0);
    for (const templatePath of templatePaths) {
      expect(files, `${templatePath} referenced by a Spec lifecycle skill must be packaged`)
        .toContain(templatePath);
    }
  });

  it("keeps spec template guidance on Codex-native commands", () => {
    for (const templatePath of referencedSpecTemplates()) {
      const template = readFileSync(templatePath, "utf8");
      expect(template, `${templatePath} must not reference legacy Kiro slash commands`)
        .not.toMatch(/\/kiro-spec-/u);
    }
  });
});
