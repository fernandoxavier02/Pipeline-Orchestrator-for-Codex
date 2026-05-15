import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("v5.2 parity public surface", () => {
  it("ships the brainstorm entrypoint and controller agents", () => {
    expect(existsSync(join(ROOT, "commands", "brainstorm.md"))).toBe(true);
    expect(existsSync(join(ROOT, "skills", "brainstorm", "SKILL.md"))).toBe(true);
    expect(existsSync(join(ROOT, "agents", "core", "brainstorm-controller.md"))).toBe(true);
    expect(existsSync(join(ROOT, "agents", "brainstorm", "step-00-intake.md"))).toBe(true);
    expect(existsSync(join(ROOT, "agents", "brainstorm", "step-01-explore.md"))).toBe(true);
  });

  it("ships prescriptive workflow skills beyond the single generic pipeline skill", () => {
    const required = [
      "audit",
      "audit-heavy",
      "audit-light",
      "bugfix",
      "bugfix-heavy",
      "bugfix-light",
      "feature",
      "feature-heavy",
      "feature-light",
      "review",
      "spec",
      "spec-audit-only",
      "spec-design",
      "spec-heavy",
      "spec-init",
      "spec-light",
      "spec-requirements",
      "spec-tasks",
      "validate-design",
      "validate-gap",
      "verify-completion",
    ];

    const shipped = new Set(readdirSync(join(ROOT, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name));

    for (const skill of required) {
      expect(shipped.has(skill), `missing skill ${skill}`).toBe(true);
      expect(existsSync(join(ROOT, "skills", skill, "SKILL.md")), `missing SKILL.md for ${skill}`).toBe(true);
    }
  });

  it("documents protocol hoisting in pipeline and brainstorm skills", () => {
    const pipeline = readFileSync(join(ROOT, "skills", "pipeline", "SKILL.md"), "utf8");
    const brainstorm = readFileSync(join(ROOT, "skills", "brainstorm", "SKILL.md"), "utf8");

    for (const content of [pipeline, brainstorm]) {
      expect(content).toContain("GATE_REQUEST");
      expect(content).toContain("DISPATCH_REQUEST");
      expect(content).toContain("protocol-events.jsonl");
    }
  });

  it("makes brainstorm exploration interactive before synthesis", () => {
    const explore = readFileSync(join(ROOT, "agents", "brainstorm", "step-01-explore.md"), "utf8");
    const controller = readFileSync(join(ROOT, "agents", "core", "brainstorm-controller.md"), "utf8");
    const command = readFileSync(join(ROOT, "commands", "brainstorm.md"), "utf8");

    expect(explore).toContain("ContextDiscovery");
    expect(explore).toContain("DecisionGap");
    expect(explore).toContain("UserInteractionGate");
    expect(explore).toContain("GATE_REQUEST");
    expect(explore).toContain("STATUS: AWAITING_GATE_RESPONSES");
    expect(explore).not.toContain("Fallback if AskUserQuestion unavailable");
    expect(explore).not.toMatch(/numbered options as plain text/i);
    expect(controller).toContain("brainstorm-explore-no-gaps");
    expect(controller).toContain("no synthesis, spec, report, or handoff may proceed");
    expect(command).toContain("guided exchange");
    expect(command).toContain("must not create a spec, report, plan, or handoff");
  });
});
