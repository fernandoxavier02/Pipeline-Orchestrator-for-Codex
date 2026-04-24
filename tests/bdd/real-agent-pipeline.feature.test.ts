import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Feature: /pipeline requires real Codex agents", () => {
  it("Given /pipeline is invoked Then the command documents strict real-agent execution", () => {
    const command = readFileSync(join(ROOT, "commands", "pipeline.md"), "utf8");

    expect(command).toContain("spawn_agent is mandatory");
    expect(command).toContain("blocked-no-agent-runtime");
  });

  it("Given the pipeline skill runs without spawn_agent Then it must block instead of emulating agents", () => {
    const skill = readFileSync(join(ROOT, "skills", "pipeline", "SKILL.md"), "utf8");

    expect(skill).toContain("blocked-no-agent-runtime");
    expect(skill).toContain("Do not fall back to TypeScript local emulation");
  });
});
