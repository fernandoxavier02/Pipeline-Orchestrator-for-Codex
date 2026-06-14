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
    expect(output.systemMessage).toContain("Call update_plan");
    expect(output.systemMessage).toContain("WORKFLOW_METHOD_GATE");
    expect(output.systemMessage).toContain("agents/core/pipeline-controller.md");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");
    expect(output.systemMessage).not.toContain("send_input");
    expect(output.systemMessage).not.toContain("agents/core/task-orchestrator.md");
  });

  it("RED: explicit pipeline hook reports advisory mode instead of pretending enforcement is proven", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo sem runtime real");
    const output = parseOutput(result);

    expect(output.hook_enforcement_mode).toBe("advisory");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("advisory");
  });

  it("ATDD: plugin mention without explicit workflow enters the canonical pipeline front door", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(
      cwd,
      "[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) quero que analise a qualidade da ultima execucao",
    );
    const output = parseOutput(result);

    expect(output.systemMessage).toContain("MANDATORY SUBAGENT EXECUTION");
    expect(output.systemMessage).toContain("plugin front door");
    expect(output.systemMessage).toContain("Call update_plan");
    expect(output.systemMessage).toContain("WORKFLOW_METHOD_GATE");
    expect(output.systemMessage).toContain("agents/core/pipeline-controller.md");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");

    const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "inject_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow",
    });
  });

  it("ATDD: app mention without explicit workflow enters the canonical pipeline front door", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(
      cwd,
      "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex) investigue e corrija a falha do fluxo",
    );
    const output = parseOutput(result);

    expect(output.systemMessage).toContain("MANDATORY SUBAGENT EXECUTION");
    expect(output.systemMessage).toContain("plugin front door");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");

    const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "inject_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow",
    });
  });

  it("ATDD: display-name mention without explicit workflow enters the canonical pipeline front door", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "@Pipeline Orchestrator for Codex audite a execucao anterior");
    const output = parseOutput(result);

    expect(output.systemMessage).toContain("MANDATORY SUBAGENT EXECUTION");
    expect(output.systemMessage).toContain("plugin front door");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");

    const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "inject_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow",
    });
  });

  it("ATDD: bare $ mentions enter the canonical pipeline front door", () => {
    const cases = [
      "$pipeline-orchestrator-for-codex",
      "$Pipeline Orchestrator for Codex audite a execucao anterior",
    ];

    for (const prompt of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, prompt);
      const output = parseOutput(result);

      expect(output.systemMessage, prompt).toContain("MANDATORY SUBAGENT EXECUTION");
      expect(output.systemMessage, prompt).toContain("plugin front door");

      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, prompt).toMatchObject({
        decision: "inject_pipeline_skill_message",
        attempted: "pipeline",
        reason: "explicit plugin-mention-default workflow",
      });
    }
  });

  it("ATDD: similar plugin slugs do not enter the canonical pipeline front door", () => {
    const cases = [
      "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex-clone) apenas abra o app",
      "[@pipeline-orchestrator-for-codexical](plugin://pipeline-orchestrator-for-codexical) apenas abra o app",
    ];

    for (const prompt of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, prompt);
      const output = parseOutput(result);

      expect(output.systemMessage, prompt).not.toContain("plugin front door");

      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, prompt).not.toMatchObject({
        decision: "inject_pipeline_skill_message",
      });
    }
  });

  it("ATDD: plugin default prompt names the governed workflow contract", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));
    const defaultPrompt = manifest.interface.defaultPrompt.join("\n");

    expect(defaultPrompt).toContain("/pipeline-orchestrator-for-codex:pipeline");
    expect(defaultPrompt).toContain("WORKFLOW_METHOD_GATE");
    expect(defaultPrompt).toContain("spawn_agent");
    expect(defaultPrompt).toContain("blocked-no-agent-runtime");
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
