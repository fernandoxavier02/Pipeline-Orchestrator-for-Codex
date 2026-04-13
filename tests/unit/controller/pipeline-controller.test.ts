import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createPipelineRuntime } from "../../../src/index.js";

describe("pipeline controller", () => {
  const runtime = createPipelineRuntime({
    cwd: process.cwd(),
    codexHome: "/codex-home",
  });

  it("parses diagnostic mode from command-like input", { timeout: 10000 }, async () => {
    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");
    expect(result.mode).toBe("diagnostic");
    expect(result.type).toBe("Audit");
  });

  it("builds a visible proposal before execution", async () => {
    const result = await runtime.controller.start("fix login redirect loop");
    expect(result.proposal.summary).toContain("fix login redirect loop");
    expect(result.proposal.variant).toMatch(/bugfix/);
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it("normalizes confirmation responses at the controller boundary", async () => {
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            currentPhase: "phase-1",
            proposal: {
              summary: "harden audit trail",
              affectedFiles: ["src/controller/pipeline-controller.ts"],
              planModeStatus: "required",
            },
          }),
        },
        checkpoints: {
          list: async () => [],
        },
      },
    });

    const result = await controller.start("Yes");

    expect(result.phase).toBe("phase-1.5");
    expect(result.implementationPlan.status).toBe("APPROVED");
  });

  it("does not resolve the reference bundle when resuming", async () => {
    let referenceIndexCalls = 0;
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({ currentPhase: "phase-2" }),
        },
        checkpoints: {
          list: async () => [{ name: "plan", status: "completed" }],
        },
      },
      referenceIndex: async () => {
        referenceIndexCalls += 1;
        throw new Error("reference bundle should not be loaded for continue mode");
      },
    });

    const result = await controller.start("/pipeline continue");

    expect(result).toEqual({
      resumeFrom: "plan",
      nextPhase: "phase-2",
    });
    expect(referenceIndexCalls).toBe(0);
  });

  it("persists a final adversarial rework rollback route during continue", { timeout: 10000 }, async () => {
    let sessionState: Record<string, unknown> = {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "bugfix-heavy",
      proposal: {
        summary: "stabilize payment flow",
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
        approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: [],
        },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/payments/checkout.ts"],
    };

    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => sessionState,
          save: async (nextSession) => {
            sessionState = nextSession as Record<string, unknown>;
          },
        },
        checkpoints: {
          list: async () => [],
        },
      },
      executionController: {
        executeApprovedWork: async () => ({
          status: "blocked",
          blockedBy: "FINAL_ADVERSARIAL_REWORK",
        }),
      } as any,
    });

    const firstResult = await controller.start("/pipeline continue");
    const secondResult = await controller.start("/pipeline continue");

    expect(firstResult.blockedBy).toBe("FINAL_ADVERSARIAL_REWORK");
    expect(firstResult.phase).toBe("phase-2");
    expect(secondResult.resumeBlocked).toBe(true);
    expect(secondResult.rollbackGate).toBe("FINAL_ADVERSARIAL_REWORK");
    expect(secondResult.rollbackRoute).toBe("replan");
  });

  it("revalidates generic blocked execution on the next continue", { timeout: 10000 }, async () => {
    let sessionState: Record<string, unknown> = {
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      mode: "--complexa",
      variant: "bugfix-heavy",
      proposal: {
        summary: "stabilize payment flow",
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
        approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: [],
        },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: ["src/payments/checkout.ts"],
    };

    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => sessionState,
          save: async (nextSession) => {
            sessionState = nextSession as Record<string, unknown>;
          },
        },
        checkpoints: {
          list: async () => [],
        },
      },
      executionController: {
        executeApprovedWork: async () => ({
          status: "blocked",
        }),
      } as any,
    });

    const firstResult = await controller.start("/pipeline continue");
    const secondResult = await controller.start("/pipeline continue");

    expect(firstResult.blockedBy).toBe("CHECKPOINT_FAIL");
    expect(firstResult.phase).toBe("phase-1.5");
    expect(secondResult.resumeBlocked).toBe(true);
    expect(secondResult.rollbackGate).toBe("CHECKPOINT_FAIL");
    expect(secondResult.rollbackRoute).toBe("revalidate");
  });

  it("fails closed on a malformed continue pending decision instead of resuming", async () => {
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            currentPhase: "phase-2",
            pendingDecision: "unknown",
            unresolvedBlockers: ["CHECKPOINT_FAIL"],
          }),
        },
        checkpoints: {
          list: async () => [],
        },
        gateLog: {
          append: async () => undefined,
          list: async () => [],
        },
      },
    });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      'Unknown continue pending decision "unknown"',
    );
  });

  it("fails closed on in-memory blocked continue state without rollback metadata", async () => {
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            currentPhase: "phase-2",
            pendingDecision: "revalidate",
            unresolvedBlockers: [],
          }),
        },
        checkpoints: {
          list: async () => [],
        },
        gateLog: {
          append: async () => undefined,
          list: async () => [],
        },
      },
    });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "Unable to resolve blocked continue rollback metadata",
    );
  });

  it("fails closed on in-memory blocked continue state with unusable gate log rollback metadata", async () => {
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            currentPhase: "phase-2",
            pendingDecision: "revalidate",
            unresolvedBlockers: [],
          }),
        },
        checkpoints: {
          list: async () => [],
        },
        gateLog: {
          append: async () => undefined,
          list: async () => [
            {
              gate: "FINAL_ADVERSARIAL_GATE",
              decision: "block",
              detail: "Final gate blocked but does not define a rollback route",
              timestamp: "2026-04-12T00:00:00.000Z",
              hardness: "SOFT",
              decided_by: "controller",
              confidence_impact: 0,
              phase: "phase-3",
            },
          ],
        },
      },
    });

    await expect(controller.start("/pipeline continue")).rejects.toThrow(
      "Unable to resolve blocked continue rollback metadata",
    );
  });
});
