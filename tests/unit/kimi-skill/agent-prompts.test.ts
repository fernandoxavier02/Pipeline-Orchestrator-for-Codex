import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const agentsDir = resolve(".kimi/skills/pipeline/agents");
const controllerPath = resolve(".kimi/skills/pipeline/agents/pipeline-controller.md");
const controller = readFileSync(controllerPath, "utf8");

const REQUIRED_AGENTS = [
  "task-orchestrator.md",
  "information-gate.md",
  "design-interrogator.md",
  "executor-controller.md",
  "review-orchestrator.md",
  "sanity-checker.md",
  "final-validator.md",
  "finishing-branch.md",
  "quality-gate-router.md",
  "plan-architect.md",
  "adversarial-security-scanner.md",
  "adversarial-architecture-critic.md",
  "adversarial-quality-reviewer.md",
];

describe("Batch 2 — C1: Agent prompt files must exist and be substantial", () => {
  for (const agent of REQUIRED_AGENTS) {
    it(`${agent} must exist`, () => {
      expect(existsSync(resolve(agentsDir, agent)), `${agent} missing`).toBe(true);
    });

    it(`${agent} must be > 500 characters`, () => {
      const content = readFileSync(resolve(agentsDir, agent), "utf8");
      expect(content.length, `${agent} is too short (${content.length} chars)`).toBeGreaterThan(500);
    });
  }
});

describe("Batch 2 — C1: Controller must load agent prompts via ReadFile", () => {
  it("must instruct controller to ReadFile agent prompts before dispatch", () => {
    expect(controller).toMatch(/ReadFile.*agent.*prompt|agent.*prompt.*ReadFile|ReadFile.*agents/i);
  });

  it("must not contain empty template placeholders like '[extracted from user arguments]' without extraction logic", () => {
    const body = controller.replace(/^---[\s\S]*?^---/m, "");
    // Allow placeholders that have extraction logic nearby (within 200 chars)
    const placeholderRegex = /\[extracted from [^\]]+\]/g;
    let match;
    const bad: string[] = [];
    while ((match = placeholderRegex.exec(body)) !== null) {
      const start = Math.max(0, match.index - 200);
      const end = Math.min(body.length, match.index + 200);
      const context = body.slice(start, end);
      // If context does not mention how to extract (e.g., "from arguments", "parse", "extract"), flag it
      const hasExtractionLogic = /from arguments|parse|extract|user request|prepend|append/i.test(context);
      if (!hasExtractionLogic) {
        bad.push(match[0]);
      }
    }
    expect(bad, `Empty placeholders without extraction logic: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("Batch 2 — C1: Agent prompts must define their role and output format", () => {
  for (const agent of REQUIRED_AGENTS) {
    it(`${agent} must define its role`, () => {
      const content = readFileSync(resolve(agentsDir, agent), "utf8").toLowerCase();
      expect(content).toMatch(/you are the|your role|your job|you act as/);
    });

    it(`${agent} must define expected output format`, () => {
      const content = readFileSync(resolve(agentsDir, agent), "utf8").toLowerCase();
      expect(content).toMatch(/produce|output|return|emit|generate|write/);
    });
  }
});
