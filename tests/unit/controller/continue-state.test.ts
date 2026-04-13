import { describe, expect, it } from "vitest";
import {
  resolveContinueResumeState,
  resolveContinueRollbackState,
} from "../../../src/controller/continue-state.js";

describe("continue state", () => {
  it("normalizes phase-2-proof-required into a blocked revalidate route", () => {
    const result = resolveContinueRollbackState({
      session: {
        currentPhase: "phase-2",
        pendingDecision: "phase-2-proof-required",
        unresolvedBlockers: ["CHECKPOINT_FAIL"],
      },
      gateLogEntries: [],
    });

    expect(result).toEqual({
      phase: "phase-2",
      resumeBlocked: true,
      rollbackGate: "CHECKPOINT_FAIL",
      rollbackRoute: "revalidate",
      rollbackDecision: "block",
      revalidationRequired: true,
    });
  });

  it.each([
    "phase-1.5-approval-required",
    "phase-1.5-reapproval-required",
  ])("normalizes %s into a blocked phase-1.5 TDD approval route", (pendingDecision) => {
    const result = resolveContinueRollbackState({
      session: {
        currentPhase: "phase-1.5",
        pendingDecision,
        unresolvedBlockers: [],
      },
      gateLogEntries: [],
    });

    expect(result).toEqual({
      phase: "phase-1.5",
      resumeBlocked: true,
      rollbackGate: "TDD_APPROVAL",
      rollbackRoute: "revalidate",
      rollbackDecision: "block",
      revalidationRequired: true,
    });
  });

  it("fails closed on malformed continue pending decisions", () => {
    expect(() =>
      resolveContinueRollbackState({
        session: {
          currentPhase: "phase-2",
          pendingDecision: "unknown",
          unresolvedBlockers: ["CHECKPOINT_FAIL"],
        },
        gateLogEntries: [],
      }),
    ).toThrow('Unknown continue pending decision "unknown"');
  });

  it("fails closed when blocked continue state lacks usable rollback metadata", () => {
    expect(() =>
      resolveContinueRollbackState({
        session: {
          currentPhase: "phase-2",
          pendingDecision: "revalidate",
          unresolvedBlockers: [],
        },
        gateLogEntries: [],
      }),
    ).toThrow("Unable to resolve blocked continue rollback metadata");
  });

  it("fails closed when blocked continue state has unusable gate log rollback metadata", () => {
    expect(() =>
      resolveContinueRollbackState({
        session: {
          currentPhase: "phase-2",
          pendingDecision: "revalidate",
          unresolvedBlockers: [],
        },
        gateLogEntries: [
          {
            gate: "FINAL_ADVERSARIAL_GATE",
            decision: "block",
            detail: "Final gate blocked but does not define a rollback route",
            timestamp: "2026-04-12T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow("Unable to resolve blocked continue rollback metadata");
  });

  it("resolves the last completed checkpoint and phase-3 fallback for resume routing", () => {
    expect(
      resolveContinueResumeState({
        session: {
          currentPhase: "phase-2",
        },
        checkpoints: [
          { name: "phase-2-batch-1", status: "completed" },
          { name: "phase-2-batch-2", status: "failed" },
        ],
      }),
    ).toEqual({
      resumeFrom: "phase-2-batch-1",
      nextPhase: "phase-2",
    });

    expect(
      resolveContinueResumeState({
        session: {
          currentPhase: "phase-3",
        },
        checkpoints: [],
      }),
    ).toEqual({
      resumeFrom: "phase-3",
      nextPhase: "phase-3",
    });
  });
});
