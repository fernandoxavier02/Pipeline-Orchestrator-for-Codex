import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createSessionStore } from "../../../src/state/session-store.js";

function createTestController(input: {
  currentPhase: string;
  proposal?: {
    summary: string;
    affectedFiles: string[];
    planModeStatus: "required" | "optional" | "skipped";
  };
  approvalProof?: {
    kind: "controller-managed-transition";
    from: "phase-1";
    to: "phase-1.5";
  };
}) {
  return createPipelineController({
    stores: {
      session: {
        load: async () => input,
      },
      checkpoints: {
        list: async () => [],
      },
    },
  });
}

describe("phase 1.5 approval", () => {
  it("persists a proposal through the real session store and accepts Yes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-phase-1-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    const proposalResult = await controller.start("/pipeline --complexa harden audit trail");
    const loadedSession = await createSessionStore(root).load();

    expect(loadedSession.proposal?.summary).toBe("harden audit trail");
    expect(loadedSession.proposal?.planModeStatus).toBe("required");

    const confirmationResult = await controller.start("Yes");

    expect(confirmationResult.phase).toBe("phase-1.5");
    expect(confirmationResult.implementationPlan.kind).toBe("IMPLEMENTATION_PLAN");
    expect(confirmationResult.implementationPlan.status).toBe("APPROVED");
    expect(proposalResult.proposal.planModeStatus).toBe("required");
  });

  it("advances a legacy phase-1 complexa session without stored proposal context", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-phase-1-legacy-"));
    writeFileSync(
      join(root, "session.json"),
      JSON.stringify({
        sessionId: "legacy-session-1",
        currentPhase: "phase-1",
        mode: "--complexa",
        variant: "implement-heavy",
        confidenceScore: 1,
      }),
      "utf8",
    );

    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    const result = await controller.start("Yes");
    const migratedSession = await createSessionStore(root).load();

    expect(result.phase).toBe("phase-1.5");
    expect(result.implementationPlan.kind).toBe("IMPLEMENTATION_PLAN");
    expect(result.implementationPlan.status).toBe("APPROVED");
    expect(migratedSession.currentPhase).toBe("phase-1.5");
  });

  it.each([
    ["yes", "APPROVED"],
    ["adjust", "ADJUSTED"],
    ["no", "REJECTED"],
  ])("returns an IMPLEMENTATION_PLAN with %s mapped to %s", async (response, status) => {
    const controller = createTestController({
      currentPhase: "phase-1.5",
      proposal: {
        summary: "harden audit trail",
        affectedFiles: ["src/controller/pipeline-controller.ts"],
        planModeStatus: "required",
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
    });

    const result = await controller.start(response);

    expect(result.implementationPlan.kind).toBe("IMPLEMENTATION_PLAN");
    expect(result.implementationPlan.status).toBe(status);
  });

  it("rejects a fabricated phase-1.5 session without controller proof", async () => {
    const controller = createPipelineController({
      stores: {
        session: {
          load: async () => ({
            currentPhase: "phase-1.5",
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

    await expect(controller.start("yes")).rejects.toThrow(
      "phase-1.5 session is missing controller-managed transition proof",
    );
  });
});
