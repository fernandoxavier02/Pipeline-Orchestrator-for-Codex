import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "force-pipeline-agents.cjs");

function runHook(cwd: string, prompt: string) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
  });
}

function parseOutput(result: ReturnType<typeof spawnSync>) {
  expect(result.status).toBe(0);
  return JSON.parse(String(result.stdout).trim());
}

describe("force pipeline agents hook", () => {
  it("records pipeline-worthy prompt decisions as JSONL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "analise este plugin e implemente os gates");

    expect(result.status).toBe(0);
    const output = parseOutput(result);
    expect(output.systemMessage).toContain("autorização explícita para delegação por subagentes");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");
    expect(output.systemMessage).not.toContain("task-orchestrator");
    const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const event = JSON.parse(readFileSync(eventsPath, "utf8").trim());
    expect(event).toMatchObject({
      hook: "force-pipeline-agents",
      event: "UserPromptSubmit",
      decision: "inject_pipeline_message",
    });
  });

  it("preserves explicit brainstorm requests made through the plugin mention", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(
      cwd,
      "[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) brainstorm entao precisa concertar essa merda",
    );

    const output = parseOutput(result);
    expect(output.systemMessage).toContain("BRAINSTORM WORKFLOW");
    expect(output.systemMessage).toContain("/pipeline-orchestrator-for-codex:brainstorm");
    expect(output.systemMessage).not.toContain("MANDATORY SUBAGENT EXECUTION — /pipeline WAS INVOKED");
    const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "inject_workflow_skill_message",
      attempted: "brainstorm",
    });
  });

  it("does not mistake /pipeline-orchestrator-for-codex:brainstorm for /pipeline", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:brainstorm precisa consertar isso");

    const output = parseOutput(result);
    expect(output.systemMessage).toContain("BRAINSTORM WORKFLOW");
    expect(output.systemMessage).not.toContain("MANDATORY SUBAGENT EXECUTION — /pipeline WAS INVOKED");
  });

  it("ATDD: explicit pipeline invocation requires pipeline-controller spawn or blocked-no-agent-runtime", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo sem agentes");
    const output = parseOutput(result);

    expect(output.systemMessage).toContain("MANDATORY SUBAGENT EXECUTION");
    expect(output.systemMessage).toContain("agents/core/pipeline-controller.md");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");
    expect(output.systemMessage).not.toContain("agents/core/task-orchestrator.md");
  });

  it("ATDD: preserves explicit governed slash workflow variants exactly", () => {
    const cases = [
      "bugfix-heavy",
      "audit-heavy",
      "feature-light",
      "spec-init",
      "spec-requirements",
      "validate-gap",
      "verify-completion",
    ];

    for (const workflow of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, `/pipeline-orchestrator-for-codex:${workflow} executar fluxo`);
      const output = parseOutput(result);

      expect(output.systemMessage, workflow).toContain(`/pipeline-orchestrator-for-codex:${workflow}`);
      expect(output.systemMessage, workflow).not.toContain("MANDATORY SUBAGENT EXECUTION — /pipeline WAS INVOKED");
      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, workflow).toMatchObject({
        decision: "inject_workflow_skill_message",
        attempted: workflow,
      });
    }
  });

  it("ATDD: preserves explicit governed plugin mention variants exactly", () => {
    const cases = ["bugfix-heavy", "spec-init", "validate-design"];

    for (const workflow of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(
        cwd,
        `[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) ${workflow} executar fluxo`,
      );
      const output = parseOutput(result);

      expect(output.systemMessage, workflow).toContain(`/pipeline-orchestrator-for-codex:${workflow}`);
      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, workflow).toMatchObject({
        decision: "inject_workflow_skill_message",
        attempted: workflow,
      });
    }
  });
});
