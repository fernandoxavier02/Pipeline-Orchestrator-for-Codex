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
        waitAgent: async (dispatch) => dispatch,
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
      agentRuntime: {
        spawnAgent: async () => ({ mode: "single-agent", role: "executor-implementer", output: {} }),
        waitAgent: async (dispatch) => dispatch,
      },
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
        waitAgent: async (dispatch) => dispatch,
      },
      sessionRoot: stateRoot,
      sessionId: "S1",
    });
    expect(spawned).toBe(true);
  });
});

describe("IMP-01: pipeline-controller opens exec-window around executeApprovedWork", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "edit-guard-controller-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("Scenario: exec-window exists on disk while executeApprovedWork runs and is deleted afterward", async () => {
    const { existsSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    const { createPipelineController } = await import("../../src/controller/pipeline-controller.js");
    const { markAuthoritativeFinalReviewResult } = await import("../../src/execution/executor-controller.js");
    const { execWindowPath } = await import("../../src/security/exec-window-store.js");

    const sessionId = "ctrl-test-session";
    let windowExistedDuringExecution = false;
    // When no stateRoot is available the controller falls back to <workspaceRoot>/.codex/pipeline
    const windowFilePath = execWindowPath(pathJoin(workspaceRoot, ".codex", "pipeline"), sessionId);

    const session = {
      sessionId,
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "feature-heavy",
      proposal: {
        summary: "payment flow",
        affectedFiles: ["src/payments.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvalProof: { kind: "controller-managed-transition", from: "phase-1", to: "phase-1.5" },
      executionProof: {
        approvedScenarios: [],
        tddApproval: "APPROVED",
        redValidation: { status: "approved", reasons: [] },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/payments.ts"],
    };

    // No store `root` props — forces the !stateRoot branch which uses mocked stores directly
    const controller = createPipelineController({
      workspaceRoot,
      stores: {
        session: { load: async () => session, save: async () => undefined },
        checkpoints: { list: async () => [], save: async () => undefined },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: { save: async () => undefined, load: async () => undefined as any },
      },
      agentRuntime: {
        capabilities: { structuredFinalState: true },
        spawnAgent: async (request: any) => ({ mode: "single-agent", role: request.role, output: {} }),
        waitAgent: async (dispatch: any) => dispatch,
        collectArtifacts: async (dispatches: any[]) => dispatches.map((dispatch) => dispatch.output),
      },
      executionController: {
        executeApprovedWork: async (_input: any) => {
          windowExistedDuringExecution = existsSync(windowFilePath);
          return markAuthoritativeFinalReviewResult({
            status: "completed",
            finalReview: { status: "approved", finalDecision: "approved" },
          });
        },
      } as any,
    });

    await controller.start("/pipeline continue");

    expect(windowExistedDuringExecution).toBe(true);
    expect(existsSync(windowFilePath)).toBe(false);
  });

  it("Scenario: executeApprovedWork receives sessionRoot and sessionId from the session", async () => {
    const { createPipelineController } = await import("../../src/controller/pipeline-controller.js");
    const { markAuthoritativeFinalReviewResult } = await import("../../src/execution/executor-controller.js");

    const sessionId = "pipe-session-99";
    let capturedInput: any;

    const session = {
      sessionId,
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "feature-heavy",
      proposal: {
        summary: "another feature",
        affectedFiles: ["src/feature.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvalProof: { kind: "controller-managed-transition", from: "phase-1", to: "phase-1.5" },
      executionProof: {
        approvedScenarios: [],
        tddApproval: "APPROVED",
        redValidation: { status: "approved", reasons: [] },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/feature.ts"],
    };

    const controller = createPipelineController({
      workspaceRoot,
      stores: {
        session: { load: async () => session, save: async () => undefined },
        checkpoints: { list: async () => [], save: async () => undefined },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: { save: async () => undefined, load: async () => undefined as any },
      },
      agentRuntime: {
        capabilities: { structuredFinalState: true },
        spawnAgent: async (request: any) => ({ mode: "single-agent", role: request.role, output: {} }),
        waitAgent: async (dispatch: any) => dispatch,
        collectArtifacts: async (dispatches: any[]) => dispatches.map((dispatch) => dispatch.output),
      },
      executionController: {
        executeApprovedWork: async (input: any) => {
          capturedInput = input;
          return markAuthoritativeFinalReviewResult({
            status: "completed",
            finalReview: { status: "approved", finalDecision: "approved" },
          });
        },
      } as any,
    });

    await controller.start("/pipeline continue");

    expect(capturedInput.sessionId).toBe(sessionId);
    expect(typeof capturedInput.sessionRoot).toBe("string");
    expect(capturedInput.sessionRoot.length).toBeGreaterThan(0);
  });
});
