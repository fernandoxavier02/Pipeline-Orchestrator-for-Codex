/**
 * Feature: Sentinel checkpoints (B4 — wire phase_2_to_3 + post_final_validator)
 *
 * The sentinel state schema already supports five checkpoints. Three were
 * wired prior to this batch (post_orchestrator, phase_0_to_1, phase_1_to_2).
 * B4 wires the remaining two.
 */

import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../src/controller/pipeline-controller.js";
import { markAuthoritativeFinalReviewResult } from "../../src/execution/executor-controller.js";

type Saved = { lastCheckpoint?: string; currentAgent?: string; expectedNext?: string[]; batchState?: { batchIndex: number; status: string } };

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
