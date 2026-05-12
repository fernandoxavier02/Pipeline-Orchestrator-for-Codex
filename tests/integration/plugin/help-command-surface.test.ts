import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("plugin help command surface", () => {
  it("ships a /pipeline-orchestrator-for-codex:help command backed by the help skill", async () => {
    const commandPath = path.join(repoRoot, "commands", "help.md");
    const commandDoc = await readFile(commandPath, "utf8");

    expect(commandDoc).toContain("# /pipeline-orchestrator-for-codex:help");
    expect(commandDoc).toContain("Use the skill `pipeline-orchestrator-for-codex:help`");
    expect(commandDoc).toContain("argument-hint");
  });

  it("documents every public pipeline workflow family and request-aware recommendations", async () => {
    const skillPath = path.join(repoRoot, "skills", "help", "SKILL.md");
    const skillDoc = await readFile(skillPath, "utf8");

    for (const workflow of [
      "/pipeline-orchestrator-for-codex:pipeline",
      "/pipeline-orchestrator-for-codex:brainstorm",
      "/pipeline-orchestrator-for-codex:bugfix-light",
      "/pipeline-orchestrator-for-codex:bugfix-heavy",
      "/pipeline-orchestrator-for-codex:feature-light",
      "/pipeline-orchestrator-for-codex:feature-heavy",
      "/pipeline-orchestrator-for-codex:audit-light",
      "/pipeline-orchestrator-for-codex:audit-heavy",
      "/pipeline-orchestrator-for-codex:spec-light",
      "/pipeline-orchestrator-for-codex:spec-heavy",
      "/pipeline-orchestrator-for-codex:review",
      "/pipeline-orchestrator-for-codex:verify-completion",
      "/pipeline-orchestrator-for-codex:validate-design",
      "/pipeline-orchestrator-for-codex:validate-gap",
    ]) {
      expect(skillDoc).toContain(workflow);
    }

    expect(skillDoc).toContain("When the user includes a request");
    expect(skillDoc).toContain("Recommended command");
    expect(skillDoc).toContain("Do not execute the recommended workflow from help");
  });
});
