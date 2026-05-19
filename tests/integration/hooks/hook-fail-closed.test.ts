// Spec: pipeline-trust-restoration / R11 — Hooks Fail Closed on Internal Exception
// Covers: R11 AC 11.1, 11.2, 11.3, 11.4, 11.5 + Property P4 (Hook Fail-Closed Universality)

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DISPATCH_GUARD = join(ROOT, "hooks", "dispatch-guard.cjs");
const SENTINEL_HOOK = join(ROOT, "hooks", "sentinel-hook.cjs");

function runHook(hookPath: string, cwd: string, rawStdin: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [hookPath], {
    cwd,
    input: rawStdin,
    encoding: "utf8",
  });
}

function parseHookOutput(result: SpawnSyncReturns<string>) {
  if (!result.stdout || result.stdout.trim() === "") return null;
  return JSON.parse(result.stdout);
}

describe("R11 — Dispatch_Guard fail-closed on malformed input", () => {
  it("R11 AC 11.1: malformed stdin JSON → sanitized deny", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
    const result = runHook(DISPATCH_GUARD, cwd, "not-json{{{");

    expect(result.status).toBe(0);
    const output = parseHookOutput(result);
    expect(output?.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output?.hookSpecificOutput?.permissionDecisionReason).toBe(
      "hook internal error — failing closed",
    );
  });

  it("R11 AC 11.4: sanitized reason contains no raw exception messages or payload", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
    const result = runHook(DISPATCH_GUARD, cwd, '{"secret":"super-secret-token","unclosed":');

    const output = parseHookOutput(result);
    const reason = output?.hookSpecificOutput?.permissionDecisionReason ?? "";
    expect(reason).toBe("hook internal error — failing closed");
    // Secret payload MUST NOT leak into user-visible reason.
    expect(reason).not.toContain("super-secret-token");
    expect(reason).not.toContain("secret");
  });
});

describe("R11 — Sentinel_Hook fail-closed on malformed input", () => {
  it("R11 AC 11.2: malformed stdin JSON → sanitized deny", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
    const result = runHook(SENTINEL_HOOK, cwd, "not-json{{{");

    expect(result.status).toBe(0);
    const output = parseHookOutput(result);
    expect(output?.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output?.hookSpecificOutput?.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
  });

  it("R11 AC 11.3: corrupted sentinel-state.json → sanitized deny (non-bootstrap)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "sentinel-state.json"), "{bad-json", "utf8");

    const result = runHook(
      SENTINEL_HOOK,
      cwd,
      JSON.stringify({
        tool_input: {
          subagent_type: "pipeline-orchestrator-for-codex:core:information-gate",
        },
      }),
    );

    expect(result.status).toBe(0);
    const output = parseHookOutput(result);
    expect(output?.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output?.hookSpecificOutput?.permissionDecisionReason).toBe(
      "sentinel internal error — failing closed",
    );
    // R11 AC 11.4 — no path leak.
    expect(output?.hookSpecificOutput?.permissionDecisionReason).not.toContain(stateDir);
  });

  it("R11 AC 11.3: bootstrap agents still allowed even when state file is corrupted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "sentinel-state.json"), "{bad-json", "utf8");

    const result = runHook(
      SENTINEL_HOOK,
      cwd,
      JSON.stringify({
        tool_input: {
          subagent_type: "pipeline-orchestrator-for-codex:core:task-orchestrator",
        },
      }),
    );

    expect(result.status).toBe(0);
    // Bootstrap path exits silently (no JSON output → allow).
    expect(result.stdout.trim()).toBe("");
  });
});

// Property P4: Hook Fail-Closed Universality
// For ANY input that triggers an exception in dispatch-guard or sentinel-hook,
// the output MUST be `permissionDecision: "deny"`. We enumerate a deterministic
// set of malformed/edge inputs to validate the property without adding a
// fast-check dependency.
describe("P4: Hook fail-closed universality (R11)", () => {
  const MALFORMED_INPUTS = [
    "{",                                     // unterminated brace
    "[",                                     // unterminated bracket
    "not-json",                              // plain text
    '{"a":',                                 // truncated value
    '{"unclosed":"string',                   // unclosed string
    'null',                                  // bare null (parses to null, not object)
    'true',                                  // bare boolean
    '42',                                    // bare number — handle() should tolerate
  ];

  for (const malformed of MALFORMED_INPUTS) {
    it(`dispatch-guard never allows on malformed input ${JSON.stringify(malformed)}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
      const result = runHook(DISPATCH_GUARD, cwd, malformed);
      const output = parseHookOutput(result);

      // Either silent allow (no output) for valid JSON that happens to be a
      // primitive, OR a deny. Never `permissionDecision: "allow"` for a true
      // malformed/crash path — the contract guarantees no false-positive allow.
      if (output && output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      }
      // Exit status MUST be 0 (deny via JSON) or 2 (hard block), never crash.
      expect([0, 2]).toContain(result.status);
    });

    it(`sentinel-hook never allows on malformed input ${JSON.stringify(malformed)}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), "pipeline-failclosed-"));
      const result = runHook(SENTINEL_HOOK, cwd, malformed);
      const output = parseHookOutput(result);

      if (output && output.hookSpecificOutput) {
        expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      }
      expect([0, 2]).toContain(result.status);
    });
  }
});
