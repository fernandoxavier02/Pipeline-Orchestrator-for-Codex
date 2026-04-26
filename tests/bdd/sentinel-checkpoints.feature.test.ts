/**
 * Feature: Sentinel checkpoints (B4 — wire phase_2_to_3 + post_final_validator)
 *
 * The sentinel state schema already supports five checkpoints. Three were
 * wired prior to this batch (post_orchestrator, phase_0_to_1, phase_1_to_2).
 * B4 wires the remaining two.
 *
 * Adversarial fixes (IMP-02, IMP-03):
 *   IMP-02 — completedPhases must be merged from prior sentinel state, not hardcoded.
 *   IMP-03 — phase_2_to_3 must also fire for non-adversarial-approved completion paths.
 */

import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../src/controller/pipeline-controller.js";
import { markAuthoritativeFinalReviewResult } from "../../src/execution/executor-controller.js";

type Saved = {
  lastCheckpoint?: string;
  currentAgent?: string;
  expectedNext?: string[];
  batchState?: { batchIndex: number; status: string };
  completedPhases?: string[];
};

describe("Feature: sentinel records phase_2_to_3 after a successful final adversarial review", () => {
  it("Scenario: continued execution with approved final review writes phase_2_to_3", async () => {
    let session: Record<string, unknown> = {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "feature-heavy",
      proposal: {
        summary: "ship the new payment flow",
        affectedFiles: ["src/payments/checkout.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: ["tests/integration/payments/checkout.feature.test.ts"],
        tddApproval: "APPROVED",
        redValidation: { status: "approved", reasons: [] },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/payments/checkout.ts"],
    };

    const sentinelSaves: Saved[] = [];

    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => session,
          save: async (next) => {
            session = next as Record<string, unknown>;
          },
        },
        checkpoints: { list: async () => [] },
        gateLog: {
          append: async () => undefined,
          list: async () => [],
        },
        confidence: {
          save: async () => undefined,
          load: async () => undefined as any,
        },
        sentinel: {
          save: async (state: unknown) => {
            sentinelSaves.push(state as Saved);
          },
          load: async () => undefined as any,
        },
      },
      executionController: {
        executeApprovedWork: async () =>
          markAuthoritativeFinalReviewResult({
            status: "ok",
            finalReview: { status: "approved", finalDecision: "approved" },
          }),
      } as any,
    });

    const result = await controller.start("/pipeline continue");
    expect(result.phase).toBe("phase-2");

    const phaseTransitionSave = sentinelSaves.find((s) => s.lastCheckpoint === "phase_2_to_3");
    expect(phaseTransitionSave).toBeDefined();
    expect(phaseTransitionSave?.currentAgent).toBe("pipeline-controller");
    expect(phaseTransitionSave?.batchState?.status).toBe("phase-2-complete");
    expect(phaseTransitionSave?.expectedNext).toEqual(
      expect.arrayContaining(["sanity-checker", "final-validator"]),
    );
  });

  it("Scenario: blocked execution does NOT write phase_2_to_3", async () => {
    let session: Record<string, unknown> = {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "feature-heavy",
      proposal: {
        summary: "ship the new payment flow",
        affectedFiles: ["src/payments/checkout.ts"],
        validationIntent: "standard",
        batchSize: 1,
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: ["tests/integration/payments/checkout.feature.test.ts"],
        tddApproval: "APPROVED",
        redValidation: { status: "approved", reasons: [] },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/payments/checkout.ts"],
    };

    const sentinelSaves: Saved[] = [];

    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => session,
          save: async (next) => {
            session = next as Record<string, unknown>;
          },
        },
        checkpoints: { list: async () => [] },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: {
          save: async (state: unknown) => {
            sentinelSaves.push(state as Saved);
          },
          load: async () => undefined as any,
        },
      },
      executionController: {
        executeApprovedWork: async () => ({ status: "blocked", blockedBy: "FINAL_ADVERSARIAL_REWORK" }),
      } as any,
    });

    await controller.start("/pipeline continue");
    expect(sentinelSaves.find((s) => s.lastCheckpoint === "phase_2_to_3")).toBeUndefined();
  });
});

describe("IMP-02: phase_2_to_3 merges completedPhases from prior sentinel state", () => {
  function makeSession() {
    return {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--simples",
      variant: "implement-light",
      proposal: {
        summary: "small fix",
        affectedFiles: ["src/utils/helper.ts"],
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
      touchedFiles: ["src/utils/helper.ts"],
    };
  }

  it("Scenario: pipeline that skipped phase-1.5 does not get phase-1.5 in completedPhases", async () => {
    const session: Record<string, unknown> = makeSession();
    const sentinelSaves: Saved[] = [];
    // Prior sentinel records only phase-0 and phase-1 (no phase-1.5)
    const priorState = {
      pipelineActive: true,
      currentPhase: "phase-1",
      currentAgent: "pipeline-controller",
      expectedNext: ["proposal-response"],
      completedPhases: ["phase-0", "phase-1"],
      gateSummary: [],
      batchState: { batchIndex: 0, status: "awaiting" },
      consecutiveCorrections: 0,
      lastCheckpoint: "phase_1_to_2",
      updatedAt: new Date().toISOString(),
    };

    const controller = createPipelineController({
      stores: {
        session: { load: async () => session, save: async () => undefined },
        checkpoints: { list: async () => [] },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: {
          save: async (state: unknown) => { sentinelSaves.push(state as Saved); },
          load: async () => priorState as any,
        },
      },
      executionController: {
        executeApprovedWork: async () =>
          markAuthoritativeFinalReviewResult({
            status: "ok",
            finalReview: { status: "approved", finalDecision: "approved" },
          }),
      } as any,
    });

    await controller.start("/pipeline continue");

    const phaseTransitionSave = sentinelSaves.find((s) => s.lastCheckpoint === "phase_2_to_3");
    expect(phaseTransitionSave).toBeDefined();
    // Must contain phase-2 from current run and prior phases — but NOT phantom phase-1.5
    expect(phaseTransitionSave?.completedPhases).toContain("phase-0");
    expect(phaseTransitionSave?.completedPhases).toContain("phase-1");
    expect(phaseTransitionSave?.completedPhases).toContain("phase-2");
    expect(phaseTransitionSave?.completedPhases).not.toContain("phase-1.5");
  });
});

describe("IMP-03: phase_2_to_3 fires for non-adversarial-approved completion paths", () => {
  function makeSession(mode = "--simples") {
    return {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode,
      variant: "implement-light",
      proposal: {
        summary: "quick patch",
        affectedFiles: ["src/config.ts"],
        validationIntent: "reduced",
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
      touchedFiles: ["src/config.ts"],
    };
  }

  it("Scenario: completed result with non-approved finalReview still writes phase_2_to_3", async () => {
    const session: Record<string, unknown> = makeSession();
    const sentinelSaves: Saved[] = [];

    const controller = createPipelineController({
      stores: {
        session: { load: async () => session, save: async () => undefined },
        checkpoints: { list: async () => [] },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: {
          save: async (state: unknown) => { sentinelSaves.push(state as Saved); },
          load: async () => undefined as any,
        },
      },
      executionController: {
        // markAuthoritativeFinalReviewResult marks the object but finalReview.status != "approved"
        executeApprovedWork: async () =>
          markAuthoritativeFinalReviewResult({
            status: "completed",
            finalReview: { status: "completed", finalDecision: "conditional" },
          }),
      } as any,
    });

    await controller.start("/pipeline continue");

    const phaseTransitionSave = sentinelSaves.find((s) => s.lastCheckpoint === "phase_2_to_3");
    expect(phaseTransitionSave).toBeDefined();
    expect(phaseTransitionSave?.currentAgent).toBe("pipeline-controller");
    expect(phaseTransitionSave?.batchState?.status).toBe("phase-2-complete");
  });

  it("Scenario: blocked result does NOT write phase_2_to_3", async () => {
    const session: Record<string, unknown> = makeSession();
    const sentinelSaves: Saved[] = [];

    const controller = createPipelineController({
      stores: {
        session: { load: async () => session, save: async () => undefined },
        checkpoints: { list: async () => [] },
        gateLog: { append: async () => undefined, list: async () => [] },
        confidence: { save: async () => undefined, load: async () => undefined as any },
        sentinel: {
          save: async (state: unknown) => { sentinelSaves.push(state as Saved); },
          load: async () => undefined as any,
        },
      },
      executionController: {
        // Not marked with markAuthoritativeFinalReviewResult → blocked path
        executeApprovedWork: async () => ({ status: "blocked", blockedBy: "RED_VALIDATION" }),
      } as any,
    });

    await controller.start("/pipeline continue");
    expect(sentinelSaves.find((s) => s.lastCheckpoint === "phase_2_to_3")).toBeUndefined();
  });
});
