import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  }, 20_000);

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
