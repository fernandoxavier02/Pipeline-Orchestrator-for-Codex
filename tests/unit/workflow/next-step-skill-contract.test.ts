import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skillsRoot = join(process.cwd(), "skills");
const commandsRoot = join(process.cwd(), "commands");

describe("workflow next-step skill contract", () => {
  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("requires every skill workflow to emit a NEXT_STEP block", () => {
    for (const skillName of skillNames) {
      const skill = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      expect(skill, `${skillName} must declare the shared next-step contract`).toContain("NEXT_STEP");
      expect(skill, `${skillName} must point at the shared next-step SSOT`).toContain("references/workflow-next-step.md");
    }
  });

  it("requires every skill workflow to open a visible plan before execution", () => {
    for (const skillName of skillNames) {
      const skill = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      expect(skill, `${skillName} must declare the shared visible plan contract`).toContain("VISIBLE_PLAN Contract");
      expect(skill, `${skillName} must point at the visible plan SSOT`).toContain("references/visible-plan-contract.md");
      expect(skill, `${skillName} must instruct the parent to call update_plan`).toContain("update_plan");
      expect(skill, `${skillName} must preserve batch execution`).toMatch(/\bbatch/i);
      expect(skill, `${skillName} must preserve adversarial review loops`).toMatch(/adversarial review/i);
      expect(skill, `${skillName} must preserve TDD`).toContain("TDD");
      expect(skill, `${skillName} must preserve ATDD`).toContain("ATDD");
      expect(skill, `${skillName} must preserve DDD`).toContain("DDD");
      expect(skill, `${skillName} must preserve PDD`).toContain("PDD");
    }
  });

  it("requires the visible Codex plan to be the first workflow contract", () => {
    for (const skillName of skillNames) {
      const skill = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      const visiblePlanIndex = skill.indexOf("## VISIBLE_PLAN Contract");
      const methodGateIndex = skill.indexOf("## WORKFLOW_METHOD_GATE Contract");

      expect(visiblePlanIndex, `${skillName} must declare a visible plan contract`).toBeGreaterThanOrEqual(0);
      expect(methodGateIndex, `${skillName} must declare a workflow method gate`).toBeGreaterThanOrEqual(0);
      expect(visiblePlanIndex, `${skillName} must open update_plan before any method gate prompt`).toBeLessThan(methodGateIndex);
      expect(skill, `${skillName} must name update_plan as the first assistant action`).toMatch(/first assistant action/i);
    }
  });

  it("requires every skill workflow to ask for workflow/method confirmation before starting", () => {
    for (const skillName of skillNames) {
      const skill = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      expect(skill, `${skillName} must declare the workflow method gate`).toContain("WORKFLOW_METHOD_GATE Contract");
      expect(skill, `${skillName} must point at the workflow method gate SSOT`).toContain("references/workflow-method-gate.md");
      expect(skill, `${skillName} must ask before starting execution`).toMatch(/before (any )?(execution|dispatch|file edit|report generation)/i);
      expect(skill, `${skillName} must allow workflow switching`).toMatch(/\baudit\b.*\bbugfix\b.*\bfeature\b.*\bux\b.*\bspec\b/is);
    }
  });

  it("makes /pipeline ask the method gate before phase-0 agent dispatch", () => {
    const pipelineSkill = readFileSync(join(skillsRoot, "pipeline", "SKILL.md"), "utf8");
    const methodGateIndex = pipelineSkill.indexOf("WORKFLOW_METHOD_GATE Contract");
    const phaseZeroIndex = pipelineSkill.indexOf("## Phase 0: Triage");
    const dispatchIndex = pipelineSkill.indexOf("## How to Dispatch an Agent");

    expect(methodGateIndex).toBeGreaterThanOrEqual(0);
    expect(methodGateIndex).toBeLessThan(dispatchIndex);
    expect(methodGateIndex).toBeLessThan(phaseZeroIndex);
  });

  it("documents the NEXT_STEP contract once in references", () => {
    const referencePath = join(process.cwd(), "references", "workflow-next-step.md");
    expect(existsSync(referencePath)).toBe(true);

    const reference = readFileSync(referencePath, "utf8");
    expect(reference).toContain("NEXT_STEP:");
    expect(reference).toContain("mode: auto | suggest | blocked | stop");
    expect(reference).toContain("src/workflow/next-step.ts");
  });

  it("documents the visible plan contract once in references", () => {
    const referencePath = join(process.cwd(), "references", "visible-plan-contract.md");
    expect(existsSync(referencePath)).toBe(true);

    const reference = readFileSync(referencePath, "utf8");
    expect(reference).toContain("VISIBLE_PLAN:");
    expect(reference).toContain("update_plan");
    expect(reference).toContain("TDD");
    expect(reference).toContain("ATDD");
    expect(reference).toContain("DDD");
    expect(reference).toContain("PDD");
  });

  it("documents the workflow method gate once in references", () => {
    const referencePath = join(process.cwd(), "references", "workflow-method-gate.md");
    expect(existsSync(referencePath)).toBe(true);

    const reference = readFileSync(referencePath, "utf8");
    expect(reference).toContain("WORKFLOW_METHOD_GATE:");
    expect(reference).toContain("selected_workflow:");
    expect(reference).toContain("wait_for_user:");
  });

  it("keeps slash commands tied to the same next-step contract", () => {
    for (const commandName of ["brainstorm.md", "pipeline.md"]) {
      const command = readFileSync(join(commandsRoot, commandName), "utf8");
      const visiblePlanIndex = command.indexOf("VISIBLE_PLAN");
      const methodGateIndex = command.indexOf("WORKFLOW_METHOD_GATE");

      expect(command, `${commandName} must mention the next-step handoff`).toContain("NEXT_STEP");
      expect(command, `${commandName} must mention visible planning`).toContain("VISIBLE_PLAN");
      expect(command, `${commandName} must point at the visible plan SSOT`).toContain("references/visible-plan-contract.md");
      expect(command, `${commandName} must mention the workflow method gate`).toContain("WORKFLOW_METHOD_GATE");
      expect(command, `${commandName} must point at the workflow method SSOT`).toContain("references/workflow-method-gate.md");
      expect(command, `${commandName} must make visible plan the first contract`).toMatch(/first assistant action/i);
      expect(visiblePlanIndex, `${commandName} must declare visible plan before workflow method gate`).toBeLessThan(methodGateIndex);
    }
  });
});
