import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("continue mode", () => {
  it("refuses to continue while proposal confirmation is pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await createSessionStore(root).save({
      sessionId: "legacy-session-1",
      currentPhase: "phase-1",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "harden audit trail",
        variant: "audit-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });
    await createCheckpointStore(root).save({
      name: "plan",
      phase: "phase-1",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-01T12:00:00.000Z",
      detail: "Plan completed",
    });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "Cannot continue while proposal confirmation is pending",
    );
  });

  it("rejects a fabricated phase-1.5 session without controller proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await createSessionStore(root).save({
      sessionId: "fabricated-session-1",
      currentPhase: "phase-1.5",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "harden audit trail",
        variant: "audit-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });
    await createCheckpointStore(root).save({
      name: "plan",
      phase: "phase-1.5",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-01T12:00:00.000Z",
      detail: "Plan completed",
    });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "phase-1.5 session is missing controller-managed transition proof",
    );
  });

  it("transitions light workflows (planModeStatus=skipped) to phase-2 after yes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-light-"));
    const sessionStore = createSessionStore(root);
    const controller = createPipelineController({
      stores: {
        session: sessionStore,
        checkpoints: createCheckpointStore(root),
      },
    });

    await sessionStore.save({
      sessionId: "light-workflow-1",
      currentPhase: "phase-1",
      mode: "--simples",
      variant: "bugfix-light",
      confidenceScore: 0.9,
      proposal: {
        summary: "quick login fix",
        variant: "bugfix-light",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "skipped",
        affectedFiles: ["src/auth/login.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });

    const confirmResult = await controller.start("yes");
    expect(confirmResult.confirmation?.status).toBe("APPROVED");
    expect(confirmResult.phase).toBe("phase-2");

    const savedSession = await sessionStore.load();
    expect(savedSession.currentPhase).toBe("phase-2");
    expect(savedSession.pendingDecision).toBe("phase-2-ready");
    expect(savedSession.approvalProof).toMatchObject({
      kind: "controller-managed-transition",
      from: "phase-1",
      to: "phase-2",
    });
  });

  it("F1: emits protocol-events.jsonl entries for proposal-confirmation gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-events-"));
    const sessionStore = createSessionStore(root);
    const controller = createPipelineController({
      workspaceRoot: root,
      stores: {
        session: sessionStore,
        checkpoints: createCheckpointStore(root),
      },
    });

    await sessionStore.save({
      sessionId: "protocol-events-light-1",
      currentPhase: "phase-1",
      mode: "--simples",
      variant: "bugfix-light",
      confidenceScore: 0.9,
      proposal: {
        summary: "quick login fix",
        variant: "bugfix-light",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "skipped",
        affectedFiles: ["src/auth/login.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });

    await controller.start("yes");

    const protocolPath = join(root, "protocol-events.jsonl");
    expect(existsSync(protocolPath)).toBe(true);
    const lines = readFileSync(protocolPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const events = lines.map((line) => JSON.parse(line));
    expect(events.some((e) => e.status === "emitted" && e.kind === "GATE_REQUEST")).toBe(true);
    expect(events.some((e) => e.status === "answered" && e.kind === "GATE_REQUEST")).toBe(true);
  });

  it("RED: blocks a bare yes when no pending proposal gate exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-bare-yes-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    const result = await controller.start("yes");

    expect(result).toMatchObject({
      status: "blocked",
      blockedBy: "SENTINEL_SEQUENCE_BLOCK",
      reason: expect.stringContaining("no pending proposal"),
    });
  });

  it("RED: proposal confirmation writes a user gate decision", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-gate-decision-"));
    const sessionStore = createSessionStore(root);
    const controller = createPipelineController({
      workspaceRoot: root,
      stores: {
        session: sessionStore,
        checkpoints: createCheckpointStore(root),
      },
    });

    await sessionStore.save({
      sessionId: "protocol-gate-decision-1",
      currentPhase: "phase-1",
      mode: "--simples",
      variant: "bugfix-light",
      confidenceScore: 0.9,
      proposal: {
        summary: "quick login fix",
        variant: "bugfix-light",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "skipped",
        affectedFiles: ["src/auth/login.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });

    await controller.start("yes");

    const decisionsPath = join(root, "gate-decisions.jsonl");
    expect(existsSync(decisionsPath)).toBe(true);
    const decisions = readFileSync(decisionsPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "SCOPE_GATE",
          decision: "pass",
          decided_by: "user",
        }),
      ]),
    );
  });

  it("does not transition to phase-2 when user rejects a light workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-continue-reject-"));
    const sessionStore = createSessionStore(root);
    const controller = createPipelineController({
      stores: {
        session: sessionStore,
        checkpoints: createCheckpointStore(root),
      },
    });

    await sessionStore.save({
      sessionId: "light-workflow-reject",
      currentPhase: "phase-1",
      mode: "--simples",
      variant: "bugfix-light",
      confidenceScore: 0.9,
      proposal: {
        summary: "quick login fix",
        variant: "bugfix-light",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "skipped",
        affectedFiles: ["src/auth/login.ts"],
        batchSize: 1,
        validationIntent: "standard",
      },
    });

    const rejectResult = await controller.start("no");
    expect(rejectResult.confirmation?.status).toBe("REJECTED");

    const savedSession = await sessionStore.load();
    expect(savedSession.currentPhase).toBe("phase-1");
  });
});
