import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const skillPath = ".kimi/skills/pipeline/SKILL.md";
const skillContent = readFileSync(skillPath, "utf8");

describe("Batch 3 — Parent Handler Loop (SKILL.md)", () => {
  describe("SKILL.md must be substantive", () => {
    it("must be > 200 lines", () => {
      const lines = skillContent.split("\n").length;
      expect(lines, `SKILL.md is only ${lines} lines`).toBeGreaterThan(200);
    });

    it("must not claim to be a thin delegator", () => {
      expect(skillContent.toLowerCase()).not.toContain("only job is to spawn");
      expect(skillContent.toLowerCase()).not.toContain("thin delegator");
    });
  });

  describe("Must spawn controller correctly", () => {
    it("must reference Agent(subagent_type: coder for controller", () => {
      expect(skillContent).toMatch(/Agent\(\s*subagent_type:\s*["']coder["']/i);
    });

    it("must reference pipeline-controller in prompt", () => {
      expect(skillContent.toLowerCase()).toContain("pipeline-controller");
    });

    it("must pass user request to controller", () => {
      expect(skillContent.toLowerCase()).toMatch(/request_text|user request|user'?s\s+message/i);
    });
  });

  describe("Must implement parent handler loop", () => {
    it("must describe a loop (repeat/until/while)", () => {
      const hasLoop =
        /repeat\s+steps?|loop\s+until|while\s+.*awaiting|repeat\s+1-?\d/i.test(skillContent);
      expect(hasLoop, "SKILL.md must describe a loop").toBe(true);
    });

    it("must reference all three AWAITING statuses", () => {
      expect(skillContent).toContain("AWAITING_GATE_RESPONSES");
      expect(skillContent).toContain("AWAITING_DISPATCH_RESULTS");
      expect(skillContent).toContain("AWAITING_PLAN_MODE_RESULTS");
    });

    it("must instruct to re-dispatch the SAME controller", () => {
      expect(skillContent.toLowerCase()).toMatch(/re-dispatch|same controller|same agent/i);
    });

    it("must instruct to prepend responses at top of prompt", () => {
      expect(skillContent.toLowerCase()).toMatch(/prepend|top of the prompt|top of prompt/i);
    });
  });

  describe("Must handle GATE_REQUEST → AskUserQuestion", () => {
    it("must reference AskUserQuestion for gate", () => {
      expect(skillContent).toContain("AskUserQuestion");
    });

    it("must reference GATE_REQUEST block parsing", () => {
      expect(skillContent).toContain("GATE_REQUEST");
    });

    it("must reference GATE_RESPONSES payload", () => {
      expect(skillContent).toContain("GATE_RESPONSES");
    });
  });

  describe("Must handle DISPATCH_REQUEST → Agent", () => {
    it("must reference Agent for dispatch", () => {
      const matches = skillContent.match(/Agent\(/g);
      expect(matches?.length ?? 0, "SKILL.md must reference Agent( multiple times").toBeGreaterThanOrEqual(2);
    });

    it("must reference DISPATCH_REQUEST block parsing", () => {
      expect(skillContent).toContain("DISPATCH_REQUEST");
    });

    it("must reference DISPATCH_RESULTS payload", () => {
      expect(skillContent).toContain("DISPATCH_RESULTS");
    });

    it("must reference both coder and explore subagent types", () => {
      expect(skillContent).toContain("coder");
      expect(skillContent).toContain("explore");
    });
  });

  describe("Must handle PLAN_MODE_REQUEST → research", () => {
    it("must reference PLAN_MODE_REQUEST", () => {
      expect(skillContent).toContain("PLAN_MODE_REQUEST");
    });

    it("must reference PLAN_MODE_RESULTS payload", () => {
      expect(skillContent).toContain("PLAN_MODE_RESULTS");
    });

    it("must reference ReadFile/Glob/Grep for research", () => {
      expect(skillContent).toContain("ReadFile");
      expect(skillContent).toContain("Glob");
      expect(skillContent).toContain("Grep");
    });
  });

  describe("Must track progress with SetTodoList", () => {
    it("must reference SetTodoList", () => {
      expect(skillContent).toContain("SetTodoList");
    });

    it("must mention all 4+ phases", () => {
      expect(skillContent).toContain("Phase 0");
      expect(skillContent).toContain("Phase 1");
      expect(skillContent).toContain("Phase 2");
      expect(skillContent).toContain("Phase 3");
    });
  });

  describe("Must handle terminal state", () => {
    it("must reference PIPELINE COMPLETE", () => {
      expect(skillContent).toContain("PIPELINE COMPLETE");
    });

    it("must not end the loop before PIPELINE COMPLETE", () => {
      expect(skillContent.toLowerCase()).toMatch(/until.*pipeline complete|while.*awaiting|repeat.*pipeline complete/i);
    });
  });

  describe("Must handle malformed blocks gracefully", () => {
    it("must reference malformed block handling", () => {
      expect(skillContent.toLowerCase()).toMatch(/malformed|invalid|missing required/i);
    });
  });
});
