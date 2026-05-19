import { appendFileSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
import { findLatestRun } from "../../../src/continue/find-latest-run.js";

describe("stale context continue routing", () => {
  it("finds the newest run folder before continue reads state", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-runs-"));
    const stateDir = join(root, ".codex", "pipeline");
    const olderRun = join(stateDir, "Pre-Feature-action", "2026-03-01-old");
    const latestRun = join(stateDir, "Pre-Feature-action", "2026-04-01-new");

    mkdirSync(olderRun, { recursive: true });
    mkdirSync(latestRun, { recursive: true });

    writeFileSync(
      join(olderRun, "session.json"),
      JSON.stringify({
        sessionId: "older",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.82,
        touchedFiles: ["src/controller/pipeline-controller.ts"],
      }),
      "utf8",
    );
    writeFileSync(join(olderRun, "gate-decisions.jsonl"), "", "utf8");

    writeFileSync(
      join(latestRun, "session.json"),
      JSON.stringify({
        sessionId: "latest",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.82,
        touchedFiles: ["src/security/auth/session.ts"],
      }),
      "utf8",
    );
    writeFileSync(join(latestRun, "gate-decisions.jsonl"), "", "utf8");
    utimesSync(join(olderRun, "session.json"), new Date("2026-03-01T12:00:00.000Z"), new Date("2026-03-01T12:00:00.000Z"));
    utimesSync(join(olderRun, "gate-decisions.jsonl"), new Date("2026-03-01T12:00:00.000Z"), new Date("2026-03-01T12:00:00.000Z"));
    utimesSync(join(latestRun, "session.json"), new Date("2026-04-01T12:00:00.000Z"), new Date("2026-04-01T12:00:00.000Z"));
    utimesSync(join(latestRun, "gate-decisions.jsonl"), new Date("2026-04-01T12:00:00.000Z"), new Date("2026-04-01T12:00:00.000Z"));

    const latest = await findLatestRun(stateDir);
    expect(latest?.runDir).toBe(latestRun);
    expect(latest?.gateLogPath).toBe(join(latestRun, "gate-decisions.jsonl"));
  });

  it("refuses blind resume when stale context escalates on sensitive complex domains", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-stale-"));
    const stateDir = join(root, ".codex", "pipeline");
    const runDir = join(stateDir, "Pre-Feature-action", "2026-03-01-auth-audit");

    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "session.json"),
      JSON.stringify({
        sessionId: "stale-session",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "audit-heavy",
        confidenceScore: 0.88,
        phase: "phase-2",
        batchIndex: 2,
        unresolvedBlockers: ["auth review not rerun"],
        pendingDecision: "revalidate",
        touchedFiles: ["src/security/auth-session.ts", "src/crypto/keys.ts"],
        proposal: {
          summary: "audit auth session handling",
          variant: "audit-heavy",
          awaitingUserConfirmation: false,
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          planModeStatus: "required",
          affectedFiles: ["src/security/auth-session.ts", "src/crypto/keys.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
      }),
      "utf8",
    );

    writeFileSync(
      join(runDir, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "ADVERSARIAL_GATE",
        hardness: "SOFT",
        phase: "phase-2",
        decision: "pass",
        decided_by: "controller",
        timestamp: "2010-01-01T00:00:00.000Z",
        detail: "Previous review is too old to trust blindly",
        confidence_impact: 0,
      })}\n`,
      "utf8",
    );
    utimesSync(join(runDir, "session.json"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(join(runDir, "gate-decisions.jsonl"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    mkdirSync(join(runDir, "checkpoints"), { recursive: true });
    writeFileSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      JSON.stringify({
        name: "phase-2-batch-1",
        phase: "phase-2",
        batchIndex: 1,
        status: "completed",
        timestamp: "2010-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    utimesSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      new Date("2010-01-01T00:00:00.000Z"),
      new Date("2010-01-01T00:00:00.000Z"),
    );

    const controller = createPipelineController({
      stores: {
        session: createSessionStore(stateDir),
        checkpoints: createCheckpointStore(stateDir),
        gateLog: createGateLog(stateDir),
      },
    });

    const result = await controller.start("/pipeline continue");

    expect(result.resumeBlocked).toBe(true);
    expect(result.staleContext?.gate).toBe("STALE_CONTEXT");
    expect(result.staleContext?.hardness).toBe("HARD");
    expect(result.resumeFrom).toBeUndefined();
    expect(readFileSync(join(runDir, "gate-decisions.jsonl"), "utf8")).toContain("ADVERSARIAL_GATE");
  });

  it("keeps a second continue blocked after a stale-context block even if a newer controller-looking run is appended", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-stale-retry-"));
    const stateDir = join(root, ".codex", "pipeline");
    const runDir = join(stateDir, "Pre-Feature-action", "2026-03-01-auth-audit");

    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "session.json"),
      JSON.stringify({
        sessionId: "stale-session-retry",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "audit-heavy",
        confidenceScore: 0.88,
        phase: "phase-2",
        batchIndex: 2,
        unresolvedBlockers: ["auth review not rerun"],
        pendingDecision: "revalidate",
        touchedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
        proposal: {
          summary: "audit auth session handling",
          variant: "audit-heavy",
          awaitingUserConfirmation: false,
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          planModeStatus: "required",
          affectedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
      }),
      "utf8",
    );

    writeFileSync(
      join(runDir, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "ADVERSARIAL_GATE",
        hardness: "SOFT",
        phase: "phase-2",
        decision: "pass",
        decided_by: "controller",
        timestamp: "2010-01-01T00:00:00.000Z",
        detail: "Previous review is too old to trust blindly",
        confidence_impact: 0,
      })}\n`,
      "utf8",
    );
    mkdirSync(join(runDir, "checkpoints"), { recursive: true });
    writeFileSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      JSON.stringify({
        name: "phase-2-batch-1",
        phase: "phase-2",
        batchIndex: 1,
        status: "completed",
        timestamp: "2010-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    utimesSync(join(runDir, "session.json"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(join(runDir, "gate-decisions.jsonl"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      new Date("2010-01-01T00:00:00.000Z"),
      new Date("2010-01-01T00:00:00.000Z"),
    );

    const controller = createPipelineController({
      stores: {
        session: createSessionStore(stateDir),
        checkpoints: createCheckpointStore(stateDir),
        gateLog: createGateLog(stateDir),
      },
    });

    const first = await controller.start("/pipeline continue");

    const laterRunDir = join(stateDir, "Pre-Feature-action", "2026-04-02-controller-looking");

    mkdirSync(laterRunDir, { recursive: true });
    writeFileSync(
      join(laterRunDir, "session.json"),
      JSON.stringify({
        sessionId: "forged-controller-looking-run",
        currentPhase: "phase-2",
        phase: "phase-2",
        batchIndex: 2,
        mode: "continue",
        variant: "audit-heavy",
        confidenceScore: 0.99,
        unresolvedBlockers: [],
        pendingDecision: "resume",
        touchedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
        proposal: {
          summary: "benign-looking new run should not outrank the locked stale run",
          variant: "audit-heavy",
          awaitingUserConfirmation: false,
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          planModeStatus: "required",
          affectedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(laterRunDir, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "INFO_GATE_OK",
        hardness: "SOFT",
        phase: "phase-0",
        decision: "pass",
        decided_by: "controller",
        timestamp: "2026-04-02T12:30:00.000Z",
        detail: "Controller-looking row should not unlock stale context",
        confidence_impact: 0,
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join(laterRunDir, "confidence-score.yaml"),
      "score: 0.99\nband: high\nthresholds:\n  medium: 0.6\n  high: 0.8\ngate_penalty: 0\ndimensions: {}\nupdated_at: 2026-04-02T12:30:00.000Z\n",
      "utf8",
    );
    mkdirSync(join(laterRunDir, "checkpoints"), { recursive: true });
    writeFileSync(
      join(laterRunDir, "checkpoints", "phase-2-batch-3.json"),
      JSON.stringify({
        name: "phase-2-batch-3",
        phase: "phase-2",
        batchIndex: 3,
        status: "completed",
        timestamp: "2026-04-02T12:30:00.000Z",
      }),
      "utf8",
    );
    utimesSync(join(laterRunDir, "session.json"), new Date("2026-04-02T12:30:00.000Z"), new Date("2026-04-02T12:30:00.000Z"));
    utimesSync(join(laterRunDir, "gate-decisions.jsonl"), new Date("2026-04-02T12:30:00.000Z"), new Date("2026-04-02T12:30:00.000Z"));
    utimesSync(join(laterRunDir, "confidence-score.yaml"), new Date("2026-04-02T12:30:00.000Z"), new Date("2026-04-02T12:30:00.000Z"));
    utimesSync(
      join(laterRunDir, "checkpoints", "phase-2-batch-3.json"),
      new Date("2026-04-02T12:30:00.000Z"),
      new Date("2026-04-02T12:30:00.000Z"),
    );

    const second = await controller.start("/pipeline continue");

    expect(first.resumeBlocked).toBe(true);
    expect(first.staleContext?.gate).toBe("STALE_CONTEXT");
    expect(second.resumeBlocked).toBe(true);
    expect(second.revalidationRequired).toBe(true);
    expect(second.resumeFrom).toBeUndefined();
    expect(second.latestRun).toBe(realpathSync(runDir));
  });

  it("routes continue using the latest gate rollback metadata before resuming", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-rollback-"));
    const stateDir = join(root, ".codex", "pipeline");
    const runDir = join(stateDir, "Pre-Feature-action", "2026-04-01-replan");

    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "session.json"),
      JSON.stringify({
        sessionId: "rollback-session",
        currentPhase: "phase-2",
        phase: "phase-2",
        batchIndex: 2,
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.91,
        unresolvedBlockers: [],
        pendingDecision: "resume",
        touchedFiles: ["src/controller/pipeline-controller.ts"],
        proposal: {
          summary: "resume after rejected plan",
          variant: "implement-heavy",
          awaitingUserConfirmation: false,
          infoGateStatus: "passed",
          designReviewStatus: "passed",
          planModeStatus: "required",
          affectedFiles: ["src/controller/pipeline-controller.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "PLAN_REJECTED",
        hardness: "HARD",
        phase: "phase-1.5",
        decision: "block",
        decided_by: "controller",
        timestamp: "2026-04-01T12:00:00.000Z",
        detail: "Plan was rejected and must be replanned",
        confidence_impact: 0,
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join(runDir, "confidence-score.yaml"),
      "score: 0.91\nband: high\nthresholds:\n  medium: 0.6\n  high: 0.8\ngate_penalty: 0\ndimensions: {}\nupdated_at: 2026-04-01T12:00:00.000Z\n",
      "utf8",
    );
    mkdirSync(join(runDir, "checkpoints"), { recursive: true });
    writeFileSync(
      join(runDir, "checkpoints", "phase-2-batch-2.json"),
      JSON.stringify({
        name: "phase-2-batch-2",
        phase: "phase-2",
        batchIndex: 2,
        status: "completed",
        timestamp: "2026-04-01T12:00:00.000Z",
      }),
      "utf8",
    );
    utimesSync(join(runDir, "session.json"), new Date("2026-04-01T12:00:00.000Z"), new Date("2026-04-01T12:00:00.000Z"));
    utimesSync(join(runDir, "gate-decisions.jsonl"), new Date("2026-04-01T12:00:00.000Z"), new Date("2026-04-01T12:00:00.000Z"));
    utimesSync(join(runDir, "confidence-score.yaml"), new Date("2026-04-01T12:00:00.000Z"), new Date("2026-04-01T12:00:00.000Z"));
    utimesSync(
      join(runDir, "checkpoints", "phase-2-batch-2.json"),
      new Date("2026-04-01T12:00:00.000Z"),
      new Date("2026-04-01T12:00:00.000Z"),
    );

    const controller = createPipelineController({
      stores: {
        session: createSessionStore(stateDir),
        checkpoints: createCheckpointStore(stateDir),
        gateLog: createGateLog(stateDir),
        confidence: createConfidenceScoreStore(stateDir),
      },
    });

    const result = await controller.start("/pipeline continue");

    expect(result.resumeBlocked).toBe(true);
    expect(result.rollbackGate).toBe("PLAN_REJECTED");
    expect(result.rollbackRoute).toBe("replan");
    expect(result.resumeFrom).toBeUndefined();
  });

  it("reloads persisted confidence instead of session confidence when stale context is reevaluated", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-confidence-"));
    const stateDir = join(root, ".codex", "pipeline");
    const runDir = join(stateDir, "Pre-Feature-action", "2026-03-01-stale-confidence");

    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "session.json"),
      JSON.stringify({
        sessionId: "stale-confidence-session",
        currentPhase: "phase-2",
        phase: "phase-2",
        batchIndex: 2,
        mode: "continue",
        variant: "audit-heavy",
        confidenceScore: 0.12,
        unresolvedBlockers: ["rerun adversarial review"],
        pendingDecision: "revalidate",
        touchedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
        proposal: {
          summary: "audit auth session handling",
          variant: "audit-heavy",
          awaitingUserConfirmation: false,
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          planModeStatus: "required",
          affectedFiles: ["src/components/report-view.ts", "src/lib/formatting.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(runDir, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "ADVERSARIAL_GATE",
        hardness: "SOFT",
        phase: "phase-2",
        decision: "pass",
        decided_by: "controller",
        timestamp: "2010-01-01T00:00:00.000Z",
        detail: "Previous review is too old to trust blindly",
        confidence_impact: 0,
      })}\n`,
      "utf8",
    );
    const confidenceStore = createConfidenceScoreStore(runDir);
    await confidenceStore.save({
      score: 0.91,
      band: "high",
      thresholds: { medium: 0.6, high: 0.8 },
      gate_penalty: 0,
      dimensions: {},
      updated_at: "2010-01-01T00:00:00.000Z",
    });
    mkdirSync(join(runDir, "checkpoints"), { recursive: true });
    writeFileSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      JSON.stringify({
        name: "phase-2-batch-1",
        phase: "phase-2",
        batchIndex: 1,
        status: "completed",
        timestamp: "2010-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    utimesSync(join(runDir, "session.json"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(join(runDir, "gate-decisions.jsonl"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(join(runDir, "confidence-score.yaml"), new Date("2010-01-01T00:00:00.000Z"), new Date("2010-01-01T00:00:00.000Z"));
    utimesSync(
      join(runDir, "checkpoints", "phase-2-batch-1.json"),
      new Date("2010-01-01T00:00:00.000Z"),
      new Date("2010-01-01T00:00:00.000Z"),
    );

    const controller = createPipelineController({
      stores: {
        session: createSessionStore(stateDir),
        checkpoints: createCheckpointStore(stateDir),
        gateLog: createGateLog(stateDir),
        confidence: createConfidenceScoreStore(stateDir),
      },
    });

    const result = await controller.start("/pipeline continue");
    const savedConfidence = await confidenceStore.load();

    expect(result.resumeBlocked).toBe(true);
    expect(result.staleContext?.gate).toBe("STALE_CONTEXT");
    expect(savedConfidence).toMatchObject({
      score: 0.81,
      band: "high",
      gate_penalty: -0.1,
    });
  });
});
