import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const specRoot = join(process.cwd(), ".kiro", "specs", "paperclip-task-tree-factory");

function readSpecFile(name: string) {
  const path = join(specRoot, name);
  expect(existsSync(path), `${name} should exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("paperclip-task-tree-factory Kiro spec", () => {
  it("ships the required Kiro spec bundle files", () => {
    for (const file of ["spec.json", "requirements.md", "design.md", "tasks.md"]) {
      expect(existsSync(join(specRoot, file)), `${file} should exist`).toBe(true);
    }
  });

  it("anchors the spec to runtime-backed Paperclip factory contracts", () => {
    const specJson = readSpecFile("spec.json");
    const requirements = readSpecFile("requirements.md");
    const design = readSpecFile("design.md");
    const tasks = readSpecFile("tasks.md");

    expect(specJson).toContain("paperclip-task-tree-factory");
    expect(specJson).toContain("references/paperclip/spec/lib/tree-factory.cjs");
    expect(specJson).toContain("repo-only spec artifact");

    for (const marker of [
      "bugfix, feature, user-story, audit, ux, spec, hotfix, and review-only",
      "blockedByIssueIds",
      "Dry_Run",
      "measure-paperclip-fidelity",
      "Repo_Only_Evidence",
    ]) {
      expect(requirements, `requirements.md missing ${marker}`).toContain(marker);
    }

    for (const marker of [
      "tree-template.cjs",
      "tree-factory.cjs",
      "tree-factory-io.cjs",
      "grow-tree.cjs",
      "measure-fidelity.cjs",
    ]) {
      expect(design, `design.md missing ${marker}`).toContain(marker);
    }

    expect(tasks).toContain("TASK-006: Validate Spec Surface");
    expect(tasks).toContain("python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py --repo-root .");
  });
});
