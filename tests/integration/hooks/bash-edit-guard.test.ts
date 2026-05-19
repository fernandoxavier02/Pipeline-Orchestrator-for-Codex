/**
 * Spec: pipeline-trust-restoration / R12 — Bash Tool Coverage in Edit Guard
 * Covers: R12 AC 12.1, 12.2, 12.3, 12.4, 12.5
 *
 * Verifies the hook (a) is wired to the `Bash` matcher in hooks.json and
 * (b) denies file-modifying Bash that targets paths outside the allowed scope
 * while still allowing read-only Bash and Bash that targets the allowed
 * .codex/ workspace.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "edit-guard-hook.cjs");
const HOOKS_JSON = join(ROOT, "hooks", "hooks.json");

function withActiveSession(cwd: string) {
  const dir = join(cwd, ".codex", "pipeline");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "session-lock.json"),
    JSON.stringify({
      session_id: "test-session",
      created_at: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      status: "active",
    }),
    "utf8",
  );
}

function runHook(cwd: string, payload: Record<string, unknown>) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

describe("R12 AC 12.1: hooks.json includes Bash in the edit-guard matcher", () => {
  it("the Bash matcher is present", () => {
    const raw = readFileSync(HOOKS_JSON, "utf8");
    const config = JSON.parse(raw);
    const preToolUse = config.hooks?.PreToolUse ?? [];
    const editGuardEntry = preToolUse.find((entry: { matcher?: string }) =>
      typeof entry.matcher === "string" && entry.matcher.includes("Bash"),
    );
    expect(editGuardEntry).toBeDefined();
    expect(editGuardEntry.matcher).toContain("Bash");
  });
});

describe("R12 — Bash hook behavior", () => {
  it("R12 AC 12.3 / AC 12.5: denies `echo x > unauthorized.txt` when exec-window is CLOSED", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-bash-edit-guard-"));
    withActiveSession(cwd);

    const result = runHook(cwd, {
      tool_name: "Bash",
      tool_input: { command: 'echo "x" > unauthorized.txt' },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Bash");
  });

  it("R12 AC 12.4: allows read-only `cat file.txt`", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-bash-edit-guard-"));
    withActiveSession(cwd);

    const result = runHook(cwd, {
      tool_name: "Bash",
      tool_input: { command: "cat file.txt" },
    });

    expect(result.status).toBe(0);
    // Read-only Bash → silent allow (no JSON output).
    expect(result.stdout.trim()).toBe("");
  });

  it("R12 AC 12.4: allows file-modifying Bash inside the .codex/ allowed scope", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-bash-edit-guard-"));
    withActiveSession(cwd);
    mkdirSync(join(cwd, ".codex", "pipeline"), { recursive: true });

    const result = runHook(cwd, {
      tool_name: "Bash",
      tool_input: { command: "echo x > .codex/pipeline/scratch.txt" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("R12 AC 12.3: denies `rm path/outside`", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-bash-edit-guard-"));
    withActiveSession(cwd);

    const result = runHook(cwd, {
      tool_name: "Bash",
      tool_input: { command: "rm path/outside/file" },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  // Post-review regression (SEC-007): additional Bash write primitives that
  // the original matcher missed.
  const SEC007_DENY_COMMANDS = [
    "dd if=/dev/zero of=/etc/important bs=1 count=1",
    'python3 -c "open(\'/etc/important\',\'w\').write(\'x\')"',
    "truncate -s 0 /etc/important",
    "install -m 755 src /etc/important",
    "ln -sf /etc/passwd /etc/important",
    "cat > /etc/important << EOF\\nx\\nEOF",
    "rsync --delete src/ /etc/dest/",
  ];

  for (const command of SEC007_DENY_COMMANDS) {
    it(`SEC-007: denies bash write primitive ${JSON.stringify(command).slice(0, 60)}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-bash-edit-guard-"));
      withActiveSession(cwd);

      const result = runHook(cwd, {
        tool_name: "Bash",
        tool_input: { command },
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    });
  }
});
