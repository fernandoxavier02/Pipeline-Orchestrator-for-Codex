import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("task-orchestrator Spec contract", () => {
  it("exposes Spec in the real-agent classification prompt", () => {
    const prompt = readFileSync("agents/core/task-orchestrator.md", "utf8");

    expect(prompt).toContain("Bug Fix | Feature | User Story | Audit | UX Simulation | Spec");
    expect(prompt).toContain("spec-light");
    expect(prompt).toContain("spec-heavy");
  });

  it("exposes Spec in the pipeline-controller agent prompt", () => {
    const controller = readFileSync("agents/core/pipeline-controller.md", "utf8");

    expect(controller).toContain("Bug Fix | Feature | User Story | Audit | UX Simulation | Spec");
    expect(controller).toContain("spec-light");
    expect(controller).toContain("spec-heavy");
  });
});
