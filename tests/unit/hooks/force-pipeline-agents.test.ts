import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "force-pipeline-agents.cjs");

function runHook(cwd: string, prompt: string, env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function runHookPayload(cwd: string, payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function parseOutput(result: ReturnType<typeof spawnSync>) {
  expect(result.status).toBe(0);
  return JSON.parse(String(result.stdout).trim());
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectValidHmacSigned(value: Record<string, unknown>, key: string, scope?: string) {
  const integrity = value._integrity as Record<string, unknown> | undefined;
  expect(integrity).toMatchObject({
    algorithm: "hmac-sha256",
    ...(scope ? { scope } : {}),
  });
  expect(typeof integrity?.signature).toBe("string");
  const unsigned = { ...value };
  delete unsigned._integrity;
  const expected = createHmac("sha256", key).update(canonicalize(unsigned)).digest("hex");
  expect(integrity?.signature).toBe(expected);
}

describe("force pipeline agents hook", () => {
  it("BDD: advises pipeline for pipeline-worthy prompts outside the canonical front door", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "analise este plugin e implemente os gates");

    expect(result.status).toBe(0);
    const output = parseOutput(result);
    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hook_enforcement_mode).toBe("advisory");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("autorização explícita para delegação por subagentes");
    expect(output.systemMessage).toContain("/pipeline-orchestrator-for-codex:pipeline");
    expect(output.systemMessage).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");
    expect(output.systemMessage).toContain("execução inline");
    expect(output.systemMessage).not.toContain("task-orchestrator");
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toBe(output.systemMessage);
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
    const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const event = JSON.parse(readFileSync(eventsPath, "utf8").trim());
    expect(event).toMatchObject({
      hook: "force-pipeline-agents",
      event: "UserPromptSubmit",
      decision: "advise_pipeline_recommended",
    });
  });

  it("TDD: advisory and enforced-workflow builders mirror systemMessage into additionalContext", () => {
    // Advisory path: a skill command routes through advisoryOutput.
    const skillCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-builder-advisory-"));
    const skillOutput = parseOutput(runHook(skillCwd, "/context mostra o estado"));
    expect(skillOutput.hook_enforcement_mode).toBe("advisory");
    expect(skillOutput.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(skillOutput.hookSpecificOutput.additionalContext).toBe(skillOutput.systemMessage);

    // Enforced-workflow path: an explicit plugin slash routes through enforcedWorkflowOutput.
    const wfCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-builder-enforced-"));
    const wfOutput = parseOutput(runHook(wfCwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo"));
    expect(wfOutput.hook_enforcement_mode).toBe("blocking");
    expect(wfOutput.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(wfOutput.hookSpecificOutput.additionalContext).toBe(wfOutput.systemMessage);
  });

  it("TDD: malformed non-string prompt payload fails closed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-malformed-"));

    const result = runHookPayload(cwd, { prompt: { text: "analise e implemente gates" } });
    const output = parseOutput(result);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("malformed-prompt-payload");
    expect(output.hook_enforcement_mode).toBe("blocking");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("Malformed UserPromptSubmit payload");
  });

  it("TDD: malformed JSON payload fails closed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-malformed-json-"));

    const result = spawnSync(process.execPath, [HOOK], {
      cwd,
      input: "{",
      encoding: "utf8",
    });
    const output = parseOutput(result);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("malformed-prompt-payload");
    expect(output.hook_enforcement_mode).toBe("blocking");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("Malformed UserPromptSubmit payload");
  });

  it.each([
    {
      label: "array",
      payload: [{ prompt: "Review the current workflow" }],
    },
    {
      label: "string scalar",
      payload: "Review the current workflow",
    },
  ])("TDD: valid JSON non-object payload fails closed $label", ({ payload }) => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-malformed-json-shape-"));

    const result = runHookPayload(cwd, payload);
    const output = parseOutput(result);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("malformed-prompt-payload");
    expect(output.hook_enforcement_mode).toBe("blocking");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("Malformed UserPromptSubmit payload");
  });

  it("RED: allows informational CI/CD pipeline explanations without pipeline-required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-informational-"));

    const result = runHook(cwd, "Explique o que é pipeline em CI/CD");
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).not.toBe("pipeline-required");
    expect(output.systemMessage).not.toContain("execução inline deste pedido está bloqueada");
  });

  it("TDD: allows hook diagnostic meta questions without pipeline-required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-meta-hook-"));

    const result = runHook(cwd, "So what's going on with the hook there? I look at it.");
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).not.toBe("pipeline-required");
    expect(output.systemMessage).not.toContain("execução inline deste pedido está bloqueada");
  });

  it("TDD: still blocks hook repair requests as pipeline-required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-repair-"));

    const result = runHook(cwd, "Fix the Pipeline Orchestrator hooks and make them work perfectly");
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it("RED: blocks mixed informational and audit prompts as pipeline-required", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-mixed-audit-"));

    const result = runHook(cwd, "Explique o que e pipeline em CI/CD e audite meu workflow atual");
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it("RED: blocks operational audit hidden behind an informational prompt field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-secondary-field-"));

    const result = runHookPayload(cwd, {
      prompt: "Explique o que e pipeline em CI/CD",
      arguments: "audite meu workflow atual",
    });
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it.each([
    {
      label: "payload.prompt",
      payload: { payload: { prompt: "Review the current workflow" } },
    },
    {
      label: "data.prompt",
      payload: { data: { prompt: "Audite o workflow atual" } },
    },
    {
      label: "message.content",
      payload: { message: { content: "Debug the current workflow" } },
    },
    {
      label: "messages[].content",
      payload: { messages: [{ role: "user", content: "Review the current workflow" }] },
    },
  ])("TDD: blocks nested operational prompt envelope $label", ({ payload }) => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-nested-operational-"));

    const result = runHookPayload(cwd, payload);
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it("TDD: JSON object payloads with no recognized prompt text fail closed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-missing-prompt-"));

    const result = runHookPayload(cwd, { payload: { ignored: "Review the current workflow" } });
    const output = parseOutput(result);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("malformed-prompt-payload");
  });

  it.each([
    "Verifique meu workflow atual",
    "Investigue meu workflow atual",
    "Revise meu workflow atual",
    "Faça uma análise do workflow atual",
    "Avalie meu workflow atual",
    "Valide meu workflow atual",
    "Cheque meu workflow atual",
    "O workflow não está funcionando",
    "Investigação do workflow atual",
    "Validação do workflow atual",
    "Revisão do workflow atual",
    "Checagem do workflow atual",
    "Diagnóstico do workflow atual",
    "Avaliacao do workflow atual",
    "Diagnostique o workflow atual",
    "Diagnosticar o workflow atual",
    "Analisa o workflow atual",
    "Audita o workflow atual",
    "Investiga o workflow atual",
    "Avalia o workflow atual",
    "Valida o workflow atual",
    "Checa o workflow atual",
    "Revisa o workflow atual",
    "Verifica o workflow atual",
    "Diagnostica o workflow atual",
    "Reavalie o workflow atual",
    "Reanalise o workflow atual",
    "Reaudite o workflow atual",
    "Faça uma probe do workflow atual",
    "Faça um pente-fino no workflow atual",
    "Faça um pente fino no fluxo atual",
  ])("RED: blocks operational Portuguese audit prompt %s", (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-pt-audit-"));

    const result = runHook(cwd, prompt);
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it.each([
    "Review the current workflow",
    "Validate the current workflow",
    "Check the current workflow",
    "Diagnose the current workflow",
    "Analyze the current workflow",
    "Assess the current workflow",
    "Evaluate the current workflow",
    "Audit the current workflow",
    "Investigate the current workflow",
    "Inspect the current workflow",
    "Look into the current workflow",
    "Triage the current workflow",
    "Debug the current workflow",
    "Examine the current workflow",
    "Confira o workflow atual",
    "Dê uma olhada no workflow atual",
    "Olhe o workflow atual",
    "Veja o workflow atual",
    "Confere o workflow atual",
    "Take a look at the current workflow",
    "Please look at the current workflow",
    "Have a look at the current workflow",
    "Take a quick look at the current workflow",
    "Give the current workflow a look",
    "Look over the current workflow",
    "Please look over the current workflow",
    "Give the current workflow another look",
    "Look the current workflow over",
    "Look through the current workflow",
    "Troubleshoot the current workflow",
    "Reaudit the current workflow",
    "Reevaluate the current workflow",
    "Reanalyse the current workflow",
    "Probe the current workflow",
    "Give the current workflow a quick look",
    "Go over the current workflow for issues",
    "Walk through the current workflow for issues",
    "Faça uma varredura no workflow atual",
    "Give the current workflow a once-over",
    "Give the current workflow one more look",
    "Please do a walkthrough of the current workflow",
    "Walk me through the current workflow for issues",
  ])("TDD: blocks operational English audit prompt %s", (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-en-audit-"));

    const result = runHook(cwd, prompt);
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
  });

  it("BDD: still blocks operational CI/CD pipeline work", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-operational-"));

    const result = runHook(cwd, "Implemente o pipeline de CI/CD para rodar lint e testes");
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
    expect(output.systemMessage).toContain("/pipeline-orchestrator-for-codex:pipeline");
  });

  it("RED: ignores empty prompt fields and blocks operational arguments payloads", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-empty-prompt-"));

    const result = runHookPayload(cwd, {
      prompt: "",
      arguments: "analise este plugin e implemente os gates",
    });
    const output = parseOutput(result);

    expect(output.continue).toBe(true);
    expect(output.stopReason).toBeUndefined();
    expect(output.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
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
      decision: "enforce_workflow_skill_message",
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
    expect(output.systemMessage).toContain("PARENT_PROTOCOL_RUNTIME");
    expect(output.systemMessage).toContain("parent_handles_dispatch_request");
    expect(output.systemMessage).toContain("blocked-no-agent-runtime");
    expect(output.systemMessage).not.toContain("send_input");
    expect(output.systemMessage).not.toContain("agents/core/task-orchestrator.md");
  });

  it("TDD: explicit pipeline hook persists deterministic intent and reports blocking enforcement", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo sem runtime real");
    const output = parseOutput(result);

    expect(output.hook_enforcement_mode).toBe("blocking");
    expect(output.enforcement_stage).toBe("stop-and-pretool");
    expect(output.pipeline_valid).toBe(false);
    expect(output.systemMessage).toContain("blocking-at-stop-and-pretool");

    const intent = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "workflow-intent.json"), "utf8"));
    expect(intent).toMatchObject({
      status: "active",
      plugin: "pipeline-orchestrator-for-codex",
      workflow: "pipeline",
      source: "slash-command",
      deterministic_enforcement: {
        stop_requires_governance_artifact: true,
        pretool_requires_canonical_dispatch: true,
        required_batch_loop: {
          checkpoint: true,
          adversarial_review: true,
          fix_loop_closed: true,
          max_fix_attempts: 3,
        },
      },
    });
    expect(intent.run_id).toEqual(expect.any(String));
    expect(intent.session_id).toEqual(expect.any(String));

    const lock = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "session-lock.json"), "utf8"));
    expect(lock).toMatchObject({
      session_id: intent.session_id,
      run_id: intent.run_id,
      workflow: "pipeline",
      status: "active",
    });

    const requiredFirstActions = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
    expect(requiredFirstActions).toMatchObject({
      status: "active",
      plugin: "pipeline-orchestrator-for-codex",
      workflow: "pipeline",
      run_id: intent.run_id,
      session_id: intent.session_id,
      required_actions: [
        "update_plan",
        "WORKFLOW_METHOD_GATE",
        "CAPABILITY_GATE",
        "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        "wait_agent",
      ],
      completed_actions: [],
    });

    const sentinel = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "sentinel-state.json"), "utf8"));
    expect(sentinel).toMatchObject({
      session_id: intent.session_id,
      run_id: intent.run_id,
      workflow_id: "pipeline",
      created_by_hook: "force-pipeline-agents",
      pipelineActive: true,
      currentPhase: "phase-0",
      currentAgent: "force-pipeline-agents",
      expectedNext: ["pipeline-controller"],
      lastCheckpoint: "workflow_intent_persisted",
    });
  });

  it("RED: explicit pipeline bootstrap persists session.json before any execution", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-session-bootstrap-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo sem runtime real");
    parseOutput(result);

    const stateDir = join(cwd, ".codex", "pipeline");
    const intent = JSON.parse(readFileSync(join(stateDir, "workflow-intent.json"), "utf8"));
    const sessionPath = join(stateDir, "session.json");

    expect(existsSync(sessionPath)).toBe(true);
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(session).toMatchObject({
      session_id: intent.session_id,
      run_id: intent.run_id,
      workflow: "pipeline",
      pipelineActive: true,
      currentPhase: "phase-0",
    });
  });

  it.each([
    {
      label: "plugin mention default",
      prompt: "[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) audite a execucao anterior",
      expectedWorkflow: "pipeline",
    },
    {
      label: "direct governed workflow",
      prompt: "/pipeline-orchestrator-for-codex:bugfix-heavy corrigir enforcement deterministico",
      expectedWorkflow: "bugfix-heavy",
    },
  ])("RED: first-message front door persists coherent session.json for $label", ({ prompt, expectedWorkflow }) => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-session-coherence-"));

    const result = runHook(cwd, prompt);
    parseOutput(result);

    const stateDir = join(cwd, ".codex", "pipeline");
    const intent = JSON.parse(readFileSync(join(stateDir, "workflow-intent.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(stateDir, "session-lock.json"), "utf8"));
    const sentinel = JSON.parse(readFileSync(join(stateDir, "sentinel-state.json"), "utf8"));
    const sessionPath = join(stateDir, "session.json");

    expect(existsSync(sessionPath)).toBe(true);
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(session).toMatchObject({
      session_id: intent.session_id,
      run_id: intent.run_id,
      workflow: expectedWorkflow,
      pipelineActive: true,
      currentPhase: "phase-0",
    });
    expect(session.session_id).toBe(lock.session_id);
    expect(session.run_id).toBe(sentinel.run_id);
    expect(session.currentPhase).toBe(sentinel.currentPhase);
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
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow intent persisted",
    });
  });

  it("TDD: generic slash from another plugin does not arm the pipeline harness", () => {
    const stateFiles = ["workflow-intent.json", "session-lock.json"];

    // Not pipeline-worthy: no bootstrap, no block, plain advisory.
    const idleCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-generic-slash-idle-"));
    const idleOutput = parseOutput(runHook(idleCwd, "/algum-outro-plugin:cmd mostra o estado"));
    expect(idleOutput.continue).toBe(true);
    for (const file of stateFiles) {
      expect(existsSync(join(idleCwd, ".codex", "pipeline", file))).toBe(false);
    }
    const idleEvent = JSON.parse(readFileSync(join(idleCwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(idleEvent.decision).not.toBe("enforce_pipeline_skill_message");

    // Pipeline-worthy text behind a foreign slash: advisory (continue true), still no bootstrap.
    const worthyCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-generic-slash-worthy-"));
    const worthyOutput = parseOutput(runHook(worthyCwd, "/algum-outro-plugin:cmd corrige o bug do fluxo"));
    expect(worthyOutput.continue).toBe(true);
    expect(worthyOutput.hookSpecificOutput.additionalContext).toContain("PIPELINE DE AGENTES OBRIGATÓRIO");
    for (const file of stateFiles) {
      expect(existsSync(join(worthyCwd, ".codex", "pipeline", file))).toBe(false);
    }
  });

  it("TDD: explicit plugin slash still bootstraps the pipeline harness", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-explicit-bootstrap-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo");
    const output = parseOutput(result);

    expect(output.hook_enforcement_mode).toBe("blocking");
    expect(output.enforcement_stage).toBe("stop-and-pretool");
    expect(output.systemMessage).toContain("MANDATORY SUBAGENT EXECUTION");

    const stateDir = join(cwd, ".codex", "pipeline");
    expect(existsSync(join(stateDir, "workflow-intent.json"))).toBe(true);
    expect(existsSync(join(stateDir, "session-lock.json"))).toBe(true);

    const event = JSON.parse(readFileSync(join(stateDir, "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit slash-command workflow intent persisted",
      harness_runtime: "cjs",
    });
  });

  it("TDD: CJS hook is the normal first-message runtime", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-cjs-harness-"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo");
    parseOutput(result);

    const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(event).toMatchObject({
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit slash-command workflow intent persisted",
      harness_runtime: "cjs",
    });
  });

  it("TDD: CJS harness enforces slash and plugin mentions without dist runtime dependency", () => {
    const slashCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-cjs-slash-"));
    const slashResult = runHook(slashCwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo");
    parseOutput(slashResult);
    const slashEvent = JSON.parse(readFileSync(join(slashCwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(slashEvent).toMatchObject({
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit slash-command workflow intent persisted",
      harness_runtime: "cjs",
    });
    expect(existsSync(join(slashCwd, ".codex", "pipeline", "session.json"))).toBe(true);

    const pluginCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-cjs-plugin-"));
    const pluginResult = runHook(
      pluginCwd,
      "[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) bugfix-heavy corrigir enforcement",
    );
    parseOutput(pluginResult);
    const pluginEvent = JSON.parse(readFileSync(join(pluginCwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
    expect(pluginEvent).toMatchObject({
      decision: "enforce_workflow_skill_message",
      attempted: "bugfix-heavy",
      reason: "explicit plugin-mention workflow intent persisted",
      harness_runtime: "cjs",
    });
    expect(existsSync(join(pluginCwd, ".codex", "pipeline", "session.json"))).toBe(true);

    const cloneCwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-cjs-clone-"));
    const cloneResult = runHook(
      cloneCwd,
      "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex-clone) apenas abra o app",
    );
    const cloneOutput = parseOutput(cloneResult);
    expect(cloneOutput.systemMessage).not.toContain("plugin front door");
  });

  it("TDD: slash prompts do not overwrite an active pipeline bootstrap", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-active-bootstrap-"));

    runHook(cwd, "/pipeline-orchestrator-for-codex:bugfix-heavy corrigir enforcement");
    const stateDir = join(cwd, ".codex", "pipeline");
    const firstIntent = JSON.parse(readFileSync(join(stateDir, "workflow-intent.json"), "utf8"));

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline sem reiniciar a run");
    parseOutput(result);

    const secondIntent = JSON.parse(readFileSync(join(stateDir, "workflow-intent.json"), "utf8"));
    expect(secondIntent.run_id).toBe(firstIntent.run_id);
    expect(secondIntent.session_id).toBe(firstIntent.session_id);
    expect(secondIntent.workflow).toBe("bugfix-heavy");

    const events = readFileSync(join(stateDir, "hook-events.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      decision: "preserve_active_pipeline_state",
      attempted: "pipeline",
      expected: "bugfix-heavy",
    });
  });

  it("TDD: explicit governed slash workflows are preserved outside the first token", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-mid-sentence-workflow-"));

    runHook(cwd, "please run /pipeline-orchestrator-for-codex:bugfix-heavy corrigir enforcement");

    const intent = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "workflow-intent.json"), "utf8"));
    expect(intent).toMatchObject({
      workflow: "bugfix-heavy",
      source: "slash-command",
    });
  });

  it("TDD: plugin mentions do not infer common workflow words from natural-language tail", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-plugin-natural-tail-"));

    runHook(cwd, "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex) review this implementation");

    const intent = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "workflow-intent.json"), "utf8"));
    expect(intent).toMatchObject({
      workflow: "pipeline",
      source: "plugin-mention-default",
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
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow intent persisted",
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
      decision: "enforce_pipeline_skill_message",
      attempted: "pipeline",
      reason: "explicit plugin-mention-default workflow intent persisted",
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
        decision: "enforce_pipeline_skill_message",
        attempted: "pipeline",
        reason: "explicit plugin-mention-default workflow intent persisted",
      });
    }
  });

  it("ATDD: #plugin pipeline orchestrator enters the canonical pipeline front door", () => {
    const cases = [
      "#plugin pipeline orchestrator",
      "#plugin pipeline orchestrator audite a execucao anterior",
      "#plugin pipeline orchestrator for codex audite a execucao anterior",
      "#plugin pipeline-orchestrator-for-codex audite a execucao anterior",
    ];

    for (const prompt of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, prompt);
      const output = parseOutput(result);

      expect(output.systemMessage, prompt).toContain("MANDATORY SUBAGENT EXECUTION");
      expect(output.systemMessage, prompt).toContain("plugin front door");
      expect(output.systemMessage, prompt).toContain("PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller");

      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, prompt).toMatchObject({
        decision: "enforce_pipeline_skill_message",
        attempted: "pipeline",
        reason: "explicit plugin-mention-default workflow intent persisted",
      });
    }
  });

  it("ATDD: similar plugin slugs do not enter the canonical pipeline front door", () => {
    const cases = [
      "[$Pipeline Orchestrator for Codex](app://pipeline-orchestrator-for-codex-clone) apenas abra o app",
      "[@pipeline-orchestrator-for-codexical](plugin://pipeline-orchestrator-for-codexical) apenas abra o app",
      "#plugin pipeline orchestration apenas abra o app",
      "#plugin pipeline-orchestrator-for-codexical apenas abra o app",
    ];

    for (const prompt of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, prompt);
      const output = parseOutput(result);

      expect(output.systemMessage, prompt).not.toContain("plugin front door");

      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, prompt).not.toMatchObject({
        decision: "enforce_pipeline_skill_message",
      });
    }
  });

  it("ATDD: preserves explicit governed #plugin workflow variants exactly", () => {
    const cases = ["bugfix-heavy", "spec-init", "validate-design"];

    for (const workflow of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));
      const result = runHook(cwd, `#plugin pipeline orchestrator ${workflow} executar fluxo`);
      const output = parseOutput(result);

      expect(output.systemMessage, workflow).toContain(`/pipeline-orchestrator-for-codex:${workflow}`);
      const event = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "hook-events.jsonl"), "utf8").trim());
      expect(event, workflow).toMatchObject({
        decision: "enforce_workflow_skill_message",
        attempted: workflow,
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
        decision: "enforce_workflow_skill_message",
        attempted: workflow,
      });
    }
  });

  it("TDD: direct bugfix-heavy front door still bootstraps controller-first", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-bugfix-heavy-"));
    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:bugfix-heavy corrigir enforcement deterministico");
    const output = parseOutput(result);

    expect(output.hook_enforcement_mode).toBe("blocking");

    const sentinel = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "sentinel-state.json"), "utf8"));
    expect(sentinel.expectedNext).toEqual(["pipeline-controller"]);
    expect(sentinel.expires_at).toEqual(expect.any(Number));

    const requiredFirstActions = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
    expect(requiredFirstActions.required_actions).toContain("spawn:pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(requiredFirstActions.required_actions).not.toContain(
      "spawn:pipeline-orchestrator-for-codex:executor:type-specific:bugfix-diagnostic-agent",
    );
  });

  it("TDD: explicit workflow front door signs state and hook event when HMAC is configured", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-hmac-"));
    const key = "force-hook-hmac-key";

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo", {
      PIPELINE_SENTINEL_HMAC_KEY: key,
    });
    parseOutput(result);

    const stateDir = join(cwd, ".codex", "pipeline");
    const intent = JSON.parse(readFileSync(join(stateDir, "workflow-intent.json"), "utf8"));
    const requiredFirstActions = JSON.parse(readFileSync(join(stateDir, "required-first-actions.json"), "utf8"));
    const sentinel = JSON.parse(readFileSync(join(stateDir, "sentinel-state.json"), "utf8"));
    const hookEvent = JSON.parse(readFileSync(join(stateDir, "hook-events.jsonl"), "utf8").trim());

    expectValidHmacSigned(intent, key, "pipeline-workflow-intent");
    expectValidHmacSigned(requiredFirstActions, key, "pipeline-required-first-actions");
    expectValidHmacSigned(sentinel, key);
    expectValidHmacSigned(hookEvent, key, "pipeline-ledger-entry");
    expect(hookEvent).toMatchObject({
      hook: "force-pipeline-agents",
      event: "UserPromptSubmit",
      decision: "enforce_pipeline_skill_message",
    });
  });

  it("TDD: explicit workflow front door refuses symlinked state files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-symlink-state-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    const targetDir = mkdtempSync(join(tmpdir(), "pipeline-force-hook-state-target-"));
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(join(targetDir, "workflow-intent.json"), join(stateDir, "workflow-intent.json"), "file");

    const result = runHook(cwd, "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo");
    const output = parseOutput(result);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toBe("pipeline-hook-error");
    expect(existsSync(join(targetDir, "workflow-intent.json"))).toBe(false);
    rmSync(targetDir, { recursive: true, force: true });
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
        decision: "enforce_workflow_skill_message",
        attempted: workflow,
      });
    }
  });
});
