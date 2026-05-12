import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const skillPath = ".kimi/skills/pipeline/SKILL.md";
const controllerPath = ".kimi/skills/pipeline/agents/pipeline-controller.md";
const skillContent = readFileSync(skillPath, "utf8");
const controllerContent = readFileSync(controllerPath, "utf8");

describe("Batch 4 — H1: Arguments substitution", () => {
  it("SKILL.md must not rely on {{arguments}} template variable", () => {
    expect(skillContent).not.toContain("{{arguments}}");
  });

  it("SKILL.md must instruct to use the user's message as request", () => {
    expect(skillContent.toLowerCase()).toMatch(/user'?s\s+(full\s+)?message|user request|the user's input/i);
  });

  it("controller must not contain {{arguments}}", () => {
    expect(controllerContent).not.toContain("{{arguments}}");
  });
});

describe("Batch 4 — H2: Reference paths not hardcoded", () => {
  it("controller must not hardcode .kimi/skills/pipeline/references/", () => {
    expect(controllerContent).not.toContain(".kimi/skills/pipeline/references/");
  });

  it("SKILL.md must pass skill install path to controller", () => {
    expect(skillContent.toLowerCase()).toMatch(/skill.path|skill path|install.path|absolute.path|SKILL_ROOT|skill_root/i);
  });

  it("controller must reference skill path variable, not literal", () => {
    const hasVarRef = /SKILL_ROOT|skill_path|skillPath|\{\{skill_path\}\}/i.test(controllerContent);
    expect(hasVarRef, "controller should reference a skill path variable").toBe(true);
  });
});

describe("Batch 4 — H4: Failure handling / circuit breaker", () => {
  it("SKILL.md must mention circuit breaker", () => {
    expect(skillContent.toLowerCase()).toMatch(/circuit.breaker|circuit-breaker|max.redispatches|maximum.redispatches|limit.redispatches/i);
  });

  it("SKILL.md must specify a maximum number of re-dispatches", () => {
    expect(skillContent.toLowerCase()).toMatch(/20\s+re-dispatches|20\s+turns|20\s+iterations|max\s*[:=]?\s*20|limit.*20/i);
  });

  it("SKILL.md must handle controller returning plain text (no blocks)", () => {
    expect(skillContent.toLowerCase()).toMatch(/plain text|no blocks|no protocol blocks|empty result/i);
  });

  it("SKILL.md must handle controller context overflow", () => {
    expect(skillContent.toLowerCase()).toMatch(/context overflow|token limit|context limit|truncat/i);
  });
});

describe("Batch 4 — H5: REVIEW-ONLY mode implementation", () => {
  it("controller must have a REVIEW-ONLY section or handler", () => {
    expect(controllerContent.toLowerCase()).toMatch(/review.only|review-only|mode.*review/i);
  });

  it("controller must describe review-only workflow steps", () => {
    const lower = controllerContent.toLowerCase();
    expect(lower).toMatch(/detect.*modified|git.*status|uncommitted|changed files/i);
  });

  it("controller must skip to final adversarial review in review-only", () => {
    expect(controllerContent.toLowerCase()).toMatch(/skip.*phase|skip.*triage|skip.*proposal|final adversarial|review.orchestrator/i);
  });
});
