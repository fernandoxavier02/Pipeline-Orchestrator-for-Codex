import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("task-orchestrator Spec contract", () => {
  it("exposes Spec in the real-agent classification prompt", () => {
    const prompt = readFileSync("agents/core/task-orchestrator.md", "utf8");

    expect(prompt).toContain("Bug Fix | Feature | User Story | Audit | UX Simulation | Spec");
    expect(prompt).toContain("spec-light");
    expect(prompt).toContain("spec-heavy");
  });

  it("exposes Spec in the /pipeline skill handoff contract", () => {
    const skill = readFileSync("skills/pipeline/SKILL.md", "utf8");

    expect(skill).toContain("Bug Fix | Feature | User Story | Audit | UX Simulation | Spec");
    expect(skill).toContain("spec-light");
    expect(skill).toContain("spec-heavy");
  });
});
