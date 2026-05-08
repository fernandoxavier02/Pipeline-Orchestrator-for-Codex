import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * B11 — JSONL sanitization. recordHookEvent must clamp every free-text
 * field to HOOK_EVENT_DETAIL_MAX_CHARS (200 chars). Run the helper in a
 * subprocess that uses the workspace as its cwd so the .codex/pipeline/
 * file lands under a temp dir we can clean up.
 */

const HOOK_EVENTS = join(process.cwd(), "hooks", "hook-events.cjs");

describe("recordHookEvent JSONL sanitization", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "hook-events-sanitization-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("truncates string fields to 200 chars (.slice(0, 200))", () => {
    const long = "x".repeat(500);
    const driver = `
      const { recordHookEvent } = require(${JSON.stringify(HOOK_EVENTS)});
      recordHookEvent({
        hook: 'test-hook',
        event: 'PreToolUse',
        decision: 'allow',
        attempted: ${JSON.stringify(long)},
        expected:  ${JSON.stringify(long)},
        reason:    ${JSON.stringify(long)},
      });
    `;
    const result = spawnSync(process.execPath, ["-e", driver], {
      cwd: workspace,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const file = join(workspace, ".codex", "pipeline", "hook-events.jsonl");
    expect(existsSync(file)).toBe(true);
    const line = readFileSync(file, "utf8").trim().split("\n").at(-1) as string;
    const entry = JSON.parse(line);
    expect(entry.attempted.length).toBe(200);
    expect(entry.expected.length).toBe(200);
    expect(entry.reason.length).toBe(200);
    expect(entry.execution_identity).toMatchObject({
      surface: "hook:test-hook",
      source: "hook",
    });
    expect(entry.execution_identity.trace_id).toMatch(/^pipe-/);
    expect(entry.execution_identity.workflow_id).toBe(entry.execution_identity.trace_id);
    expect(entry.execution_identity.event_id).toMatch(/^evt-/);
  });

  it("leaves short fields untouched", () => {
    const driver = `
      const { recordHookEvent } = require(${JSON.stringify(HOOK_EVENTS)});
      recordHookEvent({
        hook: 'short-hook',
        event: 'Stop',
        decision: 'allow',
        reason: 'cleanup',
      });
    `;
    spawnSync(process.execPath, ["-e", driver], { cwd: workspace, encoding: "utf8" });
    const file = join(workspace, ".codex", "pipeline", "hook-events.jsonl");
    const entry = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1) as string);
    expect(entry.reason).toBe("cleanup");
    expect(entry.hook).toBe("short-hook");
    expect(entry.execution_identity.surface).toBe("hook:short-hook");
  });

  it("uses the pipeline trace id from the environment when provided", () => {
    const driver = `
      const { recordHookEvent } = require(${JSON.stringify(HOOK_EVENTS)});
      recordHookEvent({
        hook: 'correlated-hook',
        event: 'PreToolUse',
        decision: 'allow',
        reason: 'correlate',
      });
    `;
    const result = spawnSync(process.execPath, ["-e", driver], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_PIPELINE_TRACE_ID: "pipe-sharedworkflow",
      },
    });

    expect(result.status).toBe(0);
    const file = join(workspace, ".codex", "pipeline", "hook-events.jsonl");
    const entry = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1) as string);
    expect(entry.execution_identity).toMatchObject({
      trace_id: "pipe-sharedworkflow",
      workflow_id: "pipe-sharedworkflow",
      event_id: expect.stringMatching(/^evt-/),
      surface: "hook:correlated-hook",
    });
  });
});
