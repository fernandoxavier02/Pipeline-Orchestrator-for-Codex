import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "dispatch-guard.cjs");

type HookOutput = {
  hookSpecificOutput?: {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
  };
};

function runHook(cwd: string, payload: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const stdout = result.stdout.trim();
  return {
    status: result.status,
    output: stdout ? JSON.parse(stdout) as HookOutput : {},
  };
}

function writeTrustedSkill(root: string, skillName: string, frontmatter: string) {
  const skillDir = join(root, "skills", skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---",
    frontmatter.trim(),
    "---",
    `# ${skillName}`,
  ].join("\n"), "utf8");
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

function signState<T extends Record<string, unknown>>(state: T, scope: string, key: string): T {
  const unsigned = { ...state };
  delete unsigned._integrity;
  return {
    ...unsigned,
    _integrity: {
      algorithm: "hmac-sha256",
      scope,
      signature: createHmac("sha256", key).update(canonicalize(unsigned)).digest("hex"),
    },
  } as T;
}

function signLedger<T extends Record<string, unknown>>(entry: T, key: string): T {
  const unsigned = { ...entry };
  delete unsigned._integrity;
  return {
    ...unsigned,
    _integrity: {
      algorithm: "hmac-sha256",
      scope: "pipeline-ledger-entry",
      signature: createHmac("sha256", key).update(canonicalize(unsigned)).digest("hex"),
    },
  } as T;
}

function writePendingRequiredFirstActions(cwd: string) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "required-first-actions.json"), JSON.stringify({
    schema_version: 1,
    status: "active",
    plugin: "pipeline-orchestrator-for-codex",
    workflow: "pipeline",
    required_actions: [
      "update_plan",
      "WORKFLOW_METHOD_GATE",
      "CAPABILITY_GATE",
      "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
      "wait_agent",
    ],
    completed_actions: [],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }), "utf8");
}

function writeRequiredFirstActions(cwd: string, state: Record<string, unknown>) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "required-first-actions.json"), JSON.stringify({
    schema_version: 1,
    status: "active",
    plugin: "pipeline-orchestrator-for-codex",
    workflow: "pipeline",
    required_actions: [
      "update_plan",
      "WORKFLOW_METHOD_GATE",
      "CAPABILITY_GATE",
      "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
      "wait_agent",
    ],
    completed_actions: [],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    ...state,
  }), "utf8");
}

function writeGateLedgers(cwd: string, key: string) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  const now = new Date().toISOString();
  const entries = [
    signLedger({
      gate: "WORKFLOW_METHOD_GATE",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "approved",
      decided_by: "user",
      timestamp: now,
      detail: "test workflow method gate",
      confidence_impact: 0,
    }, key),
    signLedger({
      gate: "CAPABILITY_GATE",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "approved",
      decided_by: "system",
      timestamp: now,
      detail: "test capability gate",
      confidence_impact: 0,
    }, key),
  ];
  writeFileSync(join(stateDir, "gate-decisions.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function writeUnsignedGateLedgers(cwd: string, timestamp = new Date().toISOString()) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  const entries = [
    {
      gate: "WORKFLOW_METHOD_GATE",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "approved",
      decided_by: "user",
      timestamp,
      detail: "test workflow method gate",
      confidence_impact: 0,
    },
    {
      gate: "CAPABILITY_GATE",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "approved",
      decided_by: "system",
      timestamp,
      detail: "test capability gate",
      confidence_impact: 0,
    },
  ];
  writeFileSync(join(stateDir, "gate-decisions.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function readLastHookEvent(cwd: string) {
  const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
  expect(existsSync(eventsPath)).toBe(true);
  const lines = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/u);
  return JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
}

describe("dispatch-guard frontmatter enforcement", () => {
  it("denies invalid skill frontmatter and writes an auditable JSONL event", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "pipeline-plugin-root-"));
    try {
      writeTrustedSkill(pluginRoot, "spec-light", [
        "agent_type: worker",
        "gates_at: [phase-1]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
        },
      }, {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("sentinel_checkpoints");
      expect(readLastHookEvent(cwd)).toMatchObject({
        hook: "dispatch-guard",
        event: "PreToolUse",
        decision: "deny",
        reason: expect.stringContaining("sentinel_checkpoints"),
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("allows valid plugin-root skill frontmatter with agent_type, gates_at, and sentinel_checkpoints", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "pipeline-plugin-root-"));
    try {
      writeTrustedSkill(pluginRoot, "spec-light", [
        "agent_type: worker",
        "gates_at: [phase-1, phase-2]",
        "sentinel_checkpoints: [post_orchestrator]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
        },
      }, {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      expect(readLastHookEvent(cwd)).toMatchObject({
        hook: "dispatch-guard",
        event: "PreToolUse",
        decision: "allow",
        reason: "frontmatter contract valid",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("denies governed skills backed only by workspace-local SKILL.md frontmatter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      writeTrustedSkill(cwd, "spec-light", [
        "agent_type: worker",
        "gates_at: [phase-1]",
        "sentinel_checkpoints: [post_orchestrator]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("missing required frontmatter");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies governed skills with tool-supplied valid frontmatter when no trusted skill file exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
          frontmatter: {
            agent_type: "worker",
            gates_at: ["phase-1"],
            sentinel_checkpoints: ["post_orchestrator"],
          },
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("missing required frontmatter");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows the real governed pipeline skill by resolving trusted on-disk frontmatter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "pipeline",
        },
      }, {
        CLAUDE_PLUGIN_ROOT: ROOT,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      expect(readLastHookEvent(cwd)).toMatchObject({
        decision: "allow",
        attempted: "pipeline",
        reason: "frontmatter contract valid",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("resolves trusted skill frontmatter from CODEX_PLUGIN_ROOT before Claude fallback", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const codexPluginRoot = mkdtempSync(join(tmpdir(), "pipeline-codex-root-"));
    const claudePluginRoot = mkdtempSync(join(tmpdir(), "pipeline-claude-root-"));
    try {
      writeTrustedSkill(codexPluginRoot, "pipeline", [
        "agent_type: worker",
        "gates_at: [phase-0]",
        "sentinel_checkpoints: [post_orchestrator]",
      ].join("\n"));
      writeTrustedSkill(claudePluginRoot, "pipeline", [
        "agent_type: root",
        "gates_at: [not-a-phase]",
        "sentinel_checkpoints: [skip-everything]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "pipeline",
        },
      }, {
        CODEX_PLUGIN_ROOT: codexPluginRoot,
        CLAUDE_PLUGIN_ROOT: claudePluginRoot,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(codexPluginRoot, { recursive: true, force: true });
      rmSync(claudePluginRoot, { recursive: true, force: true });
    }
  });

  it("ATDD: resolves trusted skill frontmatter from PLUGIN_ROOT before compatibility roots", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const canonicalPluginRoot = mkdtempSync(join(tmpdir(), "pipeline-plugin-root-"));
    const codexPluginRoot = mkdtempSync(join(tmpdir(), "pipeline-codex-root-"));
    try {
      writeTrustedSkill(canonicalPluginRoot, "pipeline", [
        "agent_type: worker",
        "gates_at: [phase-0]",
        "sentinel_checkpoints: [post_orchestrator]",
      ].join("\n"));
      writeTrustedSkill(codexPluginRoot, "pipeline", [
        "agent_type: root",
        "gates_at: [not-a-phase]",
        "sentinel_checkpoints: [skip-everything]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "pipeline",
        },
      }, {
        PLUGIN_ROOT: canonicalPluginRoot,
        CODEX_PLUGIN_ROOT: codexPluginRoot,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(canonicalPluginRoot, { recursive: true, force: true });
      rmSync(codexPluginRoot, { recursive: true, force: true });
    }
  });

  it("validates Codex spawn_agent payloads instead of only Claude subagent_type payloads", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Ask one question at a time.",
          ].join("\n"),
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies Codex spawn_agent payloads with legacy pipeline namespace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator:core:information-gate",
            "Ask one question at a time.",
          ].join("\n"),
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("legacy namespace");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies Codex spawn_agent payloads that use direct pipeline identity fields without PIPELINE_AGENT_FQN", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          subagent_type: "pipeline-orchestrator-for-codex:core:information-gate",
          message: "Ask one question at a time.",
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("PIPELINE_AGENT_FQN");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies generic spawn_agent during pending first actions and redirects to controller bootstrap", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-"));
    try {
      writePendingRequiredFirstActions(cwd);

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: "Review this repository manually.",
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("FIRST_ACTIONS_GUARD");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("Do not stop");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain(
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies controller spawn before visible plan and mandatory gates complete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-"));
    try {
      writePendingRequiredFirstActions(cwd);

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
            "Bootstrap the pipeline.",
          ].join("\n"),
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("FIRST_ACTIONS_GUARD");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("update_plan");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("WORKFLOW_METHOD_GATE");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("CAPABILITY_GATE");
      const state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: allows controller spawn after visible plan and mandatory gates complete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-"));
    const key = "unit-test-hmac-key";
    try {
      const required = signState({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "pipeline",
        created_at: new Date(Date.now() - 1000).toISOString(),
        required_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        completed_actions: ["update_plan"],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, "pipeline-required-first-actions", key);
      writeRequiredFirstActions(cwd, required);
      writeGateLedgers(cwd, key);

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
            "Bootstrap the pipeline.",
          ].join("\n"),
        },
      }, {
        PIPELINE_SENTINEL_HMAC_KEY: key,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      expect(readLastHookEvent(cwd)).toMatchObject({
        hook: "dispatch-guard",
        event: "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        decision: "allow",
      });
      const state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toEqual(["update_plan"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: records controller spawn only after PostToolUse success", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-"));
    try {
      writePendingRequiredFirstActions(cwd);

      const result = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
            "Bootstrap the pipeline.",
          ].join("\n"),
        },
        tool_response: { status: "success" },
      });

      expect(result.status).toBe(0);
      const state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toContain("spawn:pipeline-orchestrator-for-codex:core:pipeline-controller");
      expect(readLastHookEvent(cwd)).toMatchObject({
        hook: "dispatch-guard",
        event: "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        decision: "completed",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: completes canonical bootstrap from gate-marked controller spawn and nested agent response", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-bootstrap-"));
    try {
      writeRequiredFirstActions(cwd, {
        completed_actions: ["update_plan"],
      });

      const controllerMessage = [
        "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
        "WORKFLOW_METHOD_GATE: approved",
        "CAPABILITY_GATE: PASS",
        "Bootstrap the pipeline.",
      ].join("\n");

      const spawnAllowed = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: controllerMessage,
        },
      });
      expect(spawnAllowed.status).toBe(0);
      expect(spawnAllowed.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      let state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toEqual(expect.arrayContaining([
        "update_plan",
        "WORKFLOW_METHOD_GATE",
        "CAPABILITY_GATE",
      ]));

      const spawnCompleted = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: controllerMessage,
        },
        tool_response: {
          status: "success",
          output: {
            agents: [{ agentId: "agent-controller-1" }],
          },
        },
      });
      expect(spawnCompleted.status).toBe(0);
      state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toContain("spawn:pipeline-orchestrator-for-codex:core:pipeline-controller");
      expect(state.bootstrap_controller_agent_id).toBe("agent-controller-1");

      const waitCompleted = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "wait_agent",
        tool_input: { targets: ["agent-controller-1"] },
        tool_response: { status: "success" },
      });
      expect(waitCompleted.status).toBe(0);
      state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toEqual(expect.arrayContaining([
        "WORKFLOW_METHOD_GATE",
        "CAPABILITY_GATE",
        "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        "wait_agent",
      ]));

      const nextDispatch = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Continue phase 0.",
          ].join("\n"),
        },
      });
      expect(nextDispatch.status).toBe(0);
      expect(nextDispatch.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: records wait_agent after controller spawn even when host did not return a controller id", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-wait-no-id-"));
    try {
      writeRequiredFirstActions(cwd, {
        completed_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        ],
      });

      const result = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "wait_agent",
        tool_input: { targets: ["opaque-host-agent-id"] },
        tool_response: { status: "success" },
      });

      expect(result.status).toBe(0);
      const state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toContain("wait_agent");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies generic spawn_agent when signed first-actions state was tampered", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-hmac-"));
    const key = "unit-test-hmac-key";
    try {
      writeRequiredFirstActions(cwd, {
        completed_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        _integrity: {
          algorithm: "hmac-sha256",
          scope: "pipeline-required-first-actions",
          signature: "0".repeat(64),
        },
      });

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: "Review this repository manually.",
        },
      }, {
        PIPELINE_SENTINEL_HMAC_KEY: key,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("FIRST_ACTIONS_GUARD");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: permits next pipeline dispatch after signed gates and completed bootstrap actions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-complete-"));
    const key = "unit-test-hmac-key";
    try {
      const required = signState({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "pipeline",
        created_at: new Date(Date.now() - 1000).toISOString(),
        required_actions: [
          "update_plan",
          "WORKFLOW_METHOD_GATE",
          "CAPABILITY_GATE",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        completed_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, "pipeline-required-first-actions", key);
      writeRequiredFirstActions(cwd, required);
      writeGateLedgers(cwd, key);

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Continue phase 0.",
          ].join("\n"),
        },
      }, {
        PIPELINE_SENTINEL_HMAC_KEY: key,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: permits next pipeline dispatch with unsigned gate ledgers when no HMAC key is configured", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-complete-unsigned-"));
    try {
      const createdAt = new Date(Date.now() - 1000).toISOString();
      writeRequiredFirstActions(cwd, {
        created_at: createdAt,
        completed_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
      });
      writeUnsignedGateLedgers(cwd);

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Continue phase 0.",
          ].join("\n"),
        },
      }, {
        PIPELINE_SENTINEL_HMAC_KEY: "",
        PIPELINE_INTEGRITY_HMAC_KEY: "",
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies next pipeline dispatch when gate ledgers predate the current first-actions state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-replay-"));
    try {
      const createdAt = new Date(Date.now() + 60_000).toISOString();
      writeRequiredFirstActions(cwd, {
        created_at: createdAt,
        completed_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
      });
      writeUnsignedGateLedgers(cwd, new Date(Date.now() - 60_000).toISOString());

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Continue phase 0.",
          ].join("\n"),
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("FIRST_ACTIONS_GUARD");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: denies matching-session gate ledgers that predate the current first-actions state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-session-replay-"));
    try {
      const createdAt = new Date(Date.now() + 60_000).toISOString();
      writeRequiredFirstActions(cwd, {
        created_at: createdAt,
        session_id: "current-session",
        completed_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
          "wait_agent",
        ],
      });
      const stateDir = join(cwd, ".codex", "pipeline");
      const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
      const entries = [
        {
          gate: "WORKFLOW_METHOD_GATE",
          decision: "approved",
          status: "approved",
          session_id: "current-session",
          timestamp: oldTimestamp,
        },
        {
          gate: "CAPABILITY_GATE",
          decision: "approved",
          status: "approved",
          session_id: "current-session",
          timestamp: oldTimestamp,
        },
      ];
      writeFileSync(join(stateDir, "gate-decisions.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:information-gate",
            "Continue phase 0.",
          ].join("\n"),
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("FIRST_ACTIONS_GUARD");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: records wait_agent only when it targets the spawned bootstrap controller", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-first-actions-wait-"));
    try {
      writeRequiredFirstActions(cwd, {
        completed_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        ],
        bootstrap_controller_agent_id: "agent-controller-1",
      });

      const wrongWait = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "wait_agent",
        tool_input: { targets: ["agent-other"] },
        tool_response: { status: "success" },
      });
      expect(wrongWait.status).toBe(0);
      let state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).not.toContain("wait_agent");

      const rightWait = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "wait_agent",
        tool_input: { targets: ["agent-controller-1"] },
        tool_response: { status: "success" },
      });
      expect(rightWait.status).toBe(0);
      state = JSON.parse(readFileSync(join(cwd, ".codex", "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toContain("wait_agent");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("TDD: fails closed before writing completed actions through symlink ancestors", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-outside-"));
    try {
      try {
        symlinkSync(outside, join(cwd, ".codex"), "junction");
      } catch {
        return;
      }
      mkdirSync(join(outside, "pipeline"), { recursive: true });
      writeFileSync(join(outside, "pipeline", "required-first-actions.json"), JSON.stringify({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "pipeline",
        required_actions: [
          "update_plan",
          "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        ],
        completed_actions: [],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }), "utf8");

      const result = runHook(cwd, {
        hook_event_name: "PostToolUse",
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "worker",
          message: [
            "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller",
            "Bootstrap the pipeline.",
          ].join("\n"),
        },
        tool_response: { status: "success" },
      });

      expect(result.status).toBe(0);
      const state = JSON.parse(readFileSync(join(outside, "pipeline", "required-first-actions.json"), "utf8"));
      expect(state.completed_actions).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("denies Codex spawn_agent payloads that put pipeline FQNs directly in agent_type", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "spawn_agent",
        tool_input: {
          agent_type: "pipeline-orchestrator-for-codex:executor:type-specific:audit-intake",
          message: "Audit this repository.",
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain('agent_type "worker"');
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("PIPELINE_AGENT_FQN");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows imported v5.2 governed skills with manual-only frontmatter and step gates", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "bugfix-light",
        },
      }, {
        CLAUDE_PLUGIN_ROOT: ROOT,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
      expect(readLastHookEvent(cwd)).toMatchObject({
        decision: "allow",
        attempted: "bugfix-light",
        reason: "frontmatter contract valid",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows every imported v5.2 governed skill through trusted on-disk frontmatter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const governedSkills = [
      "pipeline",
      "brainstorm",
      "audit",
      "audit-heavy",
      "audit-light",
      "bugfix",
      "bugfix-heavy",
      "bugfix-light",
      "feature",
      "feature-heavy",
      "feature-light",
      "review",
      "spec",
      "spec-audit-only",
      "spec-design",
      "spec-heavy",
      "spec-init",
      "spec-light",
      "spec-requirements",
      "spec-tasks",
      "validate-design",
      "validate-gap",
      "verify-completion",
    ];
    try {
      for (const skill of governedSkills) {
        const result = runHook(cwd, {
          tool_name: "Skill",
          tool_input: { skill },
        }, {
          CLAUDE_PLUGIN_ROOT: ROOT,
        });

        expect(result.status, skill).toBe(0);
        expect(result.output.hookSpecificOutput?.permissionDecision, skill).toBeUndefined();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);

  it("denies governed skill calls when frontmatter cannot be resolved", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("frontmatter");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies invalid frontmatter enum values", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "pipeline-plugin-root-"));
    try {
      writeTrustedSkill(pluginRoot, "spec-light", [
        "agent_type: root",
        "gates_at: [not-a-phase]",
        "sentinel_checkpoints: [skip-everything]",
      ].join("\n"));

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "spec-light",
        },
      }, {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("agent_type");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("allows non-governed skills with ordinary tool-supplied frontmatter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "context",
          frontmatter: {
            name: "context",
            description: "Ordinary non-pipeline skill.",
          },
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("denies non-string agent identities instead of silently allowing malformed payloads", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const result = runHook(cwd, {
        tool_name: "Agent",
        tool_input: {
          subagent_type: 12345,
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(result.output.hookSpecificOutput?.permissionDecisionReason).toContain("agent identity");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not read tool-supplied arbitrary skill paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-frontmatter-"));
    try {
      const externalSkill = join(cwd, "external-skill.md");
      writeFileSync(externalSkill, [
        "---",
        "agent_type: root",
        "gates_at: [not-a-phase]",
        "sentinel_checkpoints: [skip-everything]",
        "---",
        "# External",
      ].join("\n"), "utf8");

      const result = runHook(cwd, {
        tool_name: "Skill",
        tool_input: {
          skill: "context",
          path: externalSkill,
        },
      });

      expect(result.status).toBe(0);
      expect(result.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
