import { describe, expect, it } from "vitest";
import {
  decideFirstMessageHarness,
  detectPipelinePluginMention,
  detectSlashCommand,
} from "../../../src/hooks/pipeline-harness.js";

const GOVERNED = [
  "pipeline",
  "bugfix-heavy",
  "audit-heavy",
  "feature-light",
  "spec-init",
  "validate-design",
];

describe("pipeline harness first-message detector", () => {
  it("triggers on any slash command, not only pipeline slash commands", () => {
    const decision = decideFirstMessageHarness({
      prompt: "/help me lembrar o estado do workflow",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "pipeline",
      source: "generic-slash-command",
      trigger: "/help",
    });
  });

  it("preserves explicit Pipeline Orchestrator workflows", () => {
    const decision = decideFirstMessageHarness({
      prompt: "/pipeline-orchestrator-for-codex:bugfix-heavy corrigir hook de primeira mensagem",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "bugfix-heavy",
      source: "pipeline-slash-command",
      trigger: "/pipeline-orchestrator-for-codex:bugfix-heavy",
    });
  });

  it("preserves explicit Pipeline Orchestrator workflows outside the first token", () => {
    const decision = decideFirstMessageHarness({
      prompt: "please run /pipeline-orchestrator-for-codex:bugfix-heavy corrigir hook",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "bugfix-heavy",
      source: "pipeline-slash-command",
    });
  });

  it("routes plugin mentions without a narrower workflow to the canonical pipeline front door", () => {
    const decision = decideFirstMessageHarness({
      prompt: "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex) audite isso",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "pipeline",
      source: "plugin-mention-default",
      trigger: "pipeline-plugin-mention",
    });
  });

  it("preserves governed workflow names after plugin mentions", () => {
    const decision = decideFirstMessageHarness({
      prompt: "#plugin pipeline orchestrator validate-design revisar spec",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "validate-design",
      source: "plugin-mention",
    });
  });

  it("does not infer common workflow words from plugin mention natural-language tails", () => {
    const decision = decideFirstMessageHarness({
      prompt: "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex) review this implementation",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toMatchObject({
      triggered: true,
      workflow: "pipeline",
      source: "plugin-mention-default",
    });
  });

  it("does not trigger on text that merely contains a URL path slash", () => {
    const decision = decideFirstMessageHarness({
      prompt: "Explique https://example.test/docs sem executar nada",
      governedWorkflows: GOVERNED,
    });

    expect(decision).toBeUndefined();
    expect(detectSlashCommand("Explique https://example.test/docs")).toBeUndefined();
  });

  it("does not treat similar plugin slugs as this plugin", () => {
    expect(detectPipelinePluginMention("#plugin pipeline-orchestrator-for-codexical audite")).toBeUndefined();
    expect(
      detectPipelinePluginMention(
        "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex-clone) apenas abra o app",
      ),
    ).toBeUndefined();
  });
});
