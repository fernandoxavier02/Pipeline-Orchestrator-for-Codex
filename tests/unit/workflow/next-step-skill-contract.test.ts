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

  it("keeps slash commands tied to the same next-step contract", () => {
    for (const commandName of ["brainstorm.md", "pipeline.md"]) {
      const command = readFileSync(join(commandsRoot, commandName), "utf8");

      expect(command, `${commandName} must mention the next-step handoff`).toContain("NEXT_STEP");
      expect(command, `${commandName} must mention visible planning`).toContain("VISIBLE_PLAN");
      expect(command, `${commandName} must point at the visible plan SSOT`).toContain("references/visible-plan-contract.md");
    }
  });
});
