import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const skillPath = ".kimi/skills/pipeline/SKILL.md";
const controllerPath = ".kimi/skills/pipeline/agents/pipeline-controller.md";
const skillContent = readFileSync(skillPath, "utf8");
const controllerContent = readFileSync(controllerPath, "utf8");

describe("Batch 6 — M2: SetTodoList timing", () => {
  it("SKILL.md must specify when to update SetTodoList", () => {
    expect(skillContent.toLowerCase()).toMatch(/update.*sett?odolist.*after|sett?odolist.*timing|after every phase|after every gate|phase transition.*update/i);
  });
});

describe("Batch 6 — M4: Protocol handler DRY", () => {
  it("must have a shared parent-handler-protocol.md reference", () => {
    const refPath = ".kimi/skills/pipeline/references/parent-handler-protocol.md";
    expect(existsSync(refPath), `${refPath} missing`).toBe(true);
  });

  it("shared reference must be > 100 lines", () => {
    const refPath = ".kimi/skills/pipeline/references/parent-handler-protocol.md";
    const content = readFileSync(refPath, "utf8");
    expect(content.split("\n").length).toBeGreaterThan(100);
  });

  it("SKILL.md must link to shared reference instead of full loop", () => {
    // SKILL.md should be leaner now or reference the shared file
    expect(skillContent.toLowerCase()).toMatch(/parent-handler-protocol|parent handler protocol/i);
  });
});

describe("Batch 6 — L2: README.md in skills directory", () => {
  it("must not have README.md in .kimi/skills/", () => {
    expect(existsSync(".kimi/skills/README.md"), ".kimi/skills/README.md should not exist").toBe(false);
  });

  it("must not have README.md in .agents/skills/", () => {
    expect(existsSync(".agents/skills/README.md"), ".agents/skills/README.md should not exist").toBe(false);
  });

  it("repo root may have README.md or KIMI_SKILL_README.md", () => {
    const hasRootReadme = existsSync("README.md") || existsSync("KIMI_SKILL_README.md");
    expect(hasRootReadme, "expected README.md or KIMI_SKILL_README.md at repo root").toBe(true);
  });
});

describe("Batch 6 — L3: Version consistency", () => {
  it("controller must not claim v1.0 in isolation", () => {
    expect(controllerContent.toLowerCase()).not.toMatch(/kimi port — v1\.0|kimi port v1\.0/);
  });

  it("controller must reference canonical version in port label", () => {
    expect(controllerContent.toLowerCase()).toMatch(/v5\.0\.0|canonical.*5|port.*5/);
  });
});
