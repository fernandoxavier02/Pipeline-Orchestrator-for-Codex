import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Feature: /pipeline requires real Codex agents", () => {
  it("Given /pipeline is invoked Then the command documents the agent execution contract", () => {
    const command = readFileSync(join(ROOT, "commands", "pipeline.md"), "utf8");

    expect(command).toContain("Agent Execution Contract");
    expect(command).toContain("blocked-no-agent-runtime");
    expect(command).toContain("strictAgents = false");
    expect(command).toContain("Operational Default");
    expect(command).toContain("never replace it with inline execution");
  });

  it("Given the pipeline skill runs without spawn_agent Then it must block instead of emulating agents", () => {
    const skill = readFileSync(join(ROOT, "skills", "pipeline", "SKILL.md"), "utf8");

    expect(skill).toContain("blocked-no-agent-runtime");
    expect(skill).toContain("Do not present emulation mode as real multi-agent execution");
  });
});
