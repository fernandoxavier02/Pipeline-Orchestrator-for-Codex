/**
 * Feature: Edit authorization (B2 — edit-guard middleware)
 *
 * Write-capable roles dispatched through runRole must have an OPEN
 * exec-window in the workspace state directory; otherwise the dispatcher
 * throws EditGuardBlockedError before the agent runtime is reached.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditGuardBlockedError, runRole } from "../../src/dispatcher/run-role.js";
import { buildExecWindow } from "../../src/security/exec-window.js";
import { createExecWindowStore } from "../../src/security/exec-window-store.js";

describe("Feature: edit-guard gates write-capable dispatches", () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "edit-guard-bdd-"));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("Scenario: dispatching executor-implementer with no exec-window is blocked", async () => {
    await expect(
      runRole({
        mode: "single-agent",
        role: "executor-implementer",
        prompt: "implement",
        input: {},
        requireRealAgent: true,
        agentRuntime: { spawnAgent: async () => ({ mode: "single-agent", role: "executor-implementer", output: {} }) },
        sessionRoot: stateRoot,
        sessionId: "S1",
      }),
    ).rejects.toThrow(EditGuardBlockedError);
  });

  it("Scenario: dispatching executor-implementer with an OPEN window proceeds to the runtime", async () => {
    const store = createExecWindowStore(stateRoot);
    store.write(
      "S1",
      buildExecWindow({
        session_id: "S1",
        now: Math.floor(Date.now() / 1000),
        ttl_seconds: 600,
        purpose: "batch-1",
        spawning_agent: "pipeline-controller",
      }),
    );

    let spawned = false;
    const result = await runRole({
      mode: "single-agent",
      role: "executor-implementer",
      prompt: "implement",
      input: {},
      requireRealAgent: true,
      agentRuntime: {
        spawnAgent: async () => {
          spawned = true;
          return {
            mode: "single-agent",
            role: "executor-implementer",
            output: { ok: true },
          };
        },
      },
      sessionRoot: stateRoot,
      sessionId: "S1",
    });
    expect(spawned).toBe(true);
    expect(result.output.ok).toBe(true);
  });

  it("Scenario: closing the window between dispatches blocks the next write", async () => {
    const store = createExecWindowStore(stateRoot);
    store.write(
      "S1",
      buildExecWindow({
        session_id: "S1",
        now: Math.floor(Date.now() / 1000),
        ttl_seconds: 600,
        purpose: "batch-1",
        spawning_agent: "pipeline-controller",
      }),
    );
    await runRole({
      mode: "single-agent",
      role: "executor-implementer",
      prompt: "implement",
      input: {},
      requireRealAgent: true,
      agentRuntime: { spawnAgent: async () => ({ mode: "single-agent", role: "executor-implementer", output: {} }) },
      sessionRoot: stateRoot,
      sessionId: "S1",
    });
    store.delete("S1");
    await expect(
      runRole({
        mode: "single-agent",
        role: "executor-implementer",
        prompt: "implement",
        input: {},
        requireRealAgent: true,
        agentRuntime: { spawnAgent: async () => ({ mode: "single-agent", role: "executor-implementer", output: {} }) },
        sessionRoot: stateRoot,
        sessionId: "S1",
      }),
    ).rejects.toThrow(EditGuardBlockedError);
  });

  it("Scenario: review-orchestrator (non-write role) is not gated", async () => {
    let spawned = false;
    await runRole({
      mode: "single-agent",
      role: "review-orchestrator",
      prompt: "review",
      input: {},
      requireRealAgent: true,
      agentRuntime: {
        spawnAgent: async () => {
          spawned = true;
          return { mode: "single-agent", role: "review-orchestrator", output: {} };
        },
      },
      sessionRoot: stateRoot,
      sessionId: "S1",
    });
    expect(spawned).toBe(true);
  });
});
