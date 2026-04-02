import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
      workspaceRoot: root,
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
    const scaffoldedSession = await createSessionStore(root).load();
    const planApprovalResult = await controller.start("Yes");
    const approvedSession = await createSessionStore(root).load();

    expect(confirmationResult.phase).toBe("phase-1.5");
    expect(confirmationResult.implementationPlan.kind).toBe("IMPLEMENTATION_PLAN");
    expect(confirmationResult.implementationPlan.status).toBe("APPROVED");
    expect(proposalResult.proposal.planModeStatus).toBe("required");
    expect(scaffoldedSession.executionProof).toMatchObject({
      tddApproval: "REJECTED",
      redValidation: {
        status: "blocked",
      },
      checkpointEvidence: [],
      fixAttempts: [],
    });
    expect(planApprovalResult.phase).toBe("phase-1.5");
    expect(planApprovalResult.implementationPlan.status).toBe("APPROVED");
    expect(approvedSession.executionProof).toMatchObject({
      tddApproval: "REJECTED",
      redValidation: {
        status: "blocked",
      },
      checkpointEvidence: [],
      fixAttempts: [],
    });
    expect(approvedSession.executionProof?.approvedScenarios.length).toBeGreaterThan(0);
    expect(
      approvedSession.executionProof?.approvedScenarios.every((scenario) =>
        scenario.startsWith("tests/") && scenario.endsWith(".test.ts")
      ),
    ).toBe(true);
    expect(
      approvedSession.executionProof?.approvedScenarios.some((scenario) =>
        scenario.endsWith("pipeline-controller.test.ts")
      ),
    ).toBe(true);
  });

  it.each([
    ["No", "REJECTED"],
    ["Adjust", "ADJUSTED"],
  ])("revokes previously approved execution scenarios when phase-1.5 receives %s", async (response, status) => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-phase-1-revoke-"));
    const controller = createPipelineController({
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await controller.start("/pipeline --complexa stabilize login flow");
    await controller.start("Yes");
    await controller.start("Yes");

    const result = await controller.start(response);
    const revokedSession = await createSessionStore(root).load();

    expect(result.implementationPlan.status).toBe(status);
    expect(revokedSession.executionProof).toMatchObject({
      approvedScenarios: [],
      tddApproval: "REJECTED",
      redValidation: {
        status: "blocked",
      },
    });
  });

  it("does not approve unrelated tests from broad file-stem collisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-phase-1-collision-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "tests", "collision"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const source = 'index';\n", "utf8");
    writeFileSync(
      join(root, "tests", "collision", "unrelated-index.test.ts"),
      "import { describe, expect, it } from 'vitest';\n\ndescribe('index helper', () => {\n  it('uses a generic index label only', () => {\n    expect('index').toBe('index');\n  });\n});\n",
      "utf8",
    );
    writeFileSync(
      join(root, "session.json"),
      JSON.stringify({
        sessionId: "collision-session-1",
        currentPhase: "phase-1.5",
        phase: "phase-1.5",
        batchIndex: 0,
        mode: "--complexa",
        variant: "bugfix-heavy",
        confidenceScore: 1,
        proposal: {
          summary: "tighten index orchestration",
          variant: "bugfix-heavy",
          affectedFiles: ["src/index.ts"],
          planModeStatus: "required",
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          validationIntent: "standard",
          batchSize: 1,
        },
        approvalProof: {
          kind: "controller-managed-transition",
          from: "phase-1",
          to: "phase-1.5",
        },
        executionProof: {
          approvedScenarios: [],
          tddApproval: "REJECTED",
          redValidation: {
            status: "blocked",
            reasons: ["RED validation proof is required before implementation"],
          },
          checkpointEvidence: [],
          fixAttempts: [],
        },
      }),
      "utf8",
    );
    const controller = createPipelineController({
      workspaceRoot: root,
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await controller.start("Yes");
    const approvedSession = await createSessionStore(root).load();

    expect(approvedSession.executionProof?.approvedScenarios).toEqual([]);
  });

  it("does not approve tests that only mention an affected file path in comments or strings", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-phase-1-spoofed-proof-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "tests", "spoofed"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const source = 'index';\n", "utf8");
    writeFileSync(
      join(root, "tests", "spoofed", "comment-only.test.ts"),
      "import { describe, expect, it } from 'vitest';\n\n// touching src/index.ts in a comment must not count as proof\nconst proofHint = 'src/index.ts';\n\ndescribe('spoofed proof', () => {\n  it('mentions the file path only as data', () => {\n    expect(proofHint).toBe('src/index.ts');\n  });\n});\n",
      "utf8",
    );
    writeFileSync(
      join(root, "session.json"),
      JSON.stringify({
        sessionId: "spoofed-proof-session-1",
        currentPhase: "phase-1.5",
        phase: "phase-1.5",
        batchIndex: 0,
        mode: "--complexa",
        variant: "bugfix-heavy",
        confidenceScore: 1,
        proposal: {
          summary: "tighten index orchestration",
          variant: "bugfix-heavy",
          affectedFiles: ["src/index.ts"],
          planModeStatus: "required",
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          validationIntent: "standard",
          batchSize: 1,
        },
        approvalProof: {
          kind: "controller-managed-transition",
          from: "phase-1",
          to: "phase-1.5",
        },
        executionProof: {
          approvedScenarios: [],
          tddApproval: "REJECTED",
          redValidation: {
            status: "blocked",
            reasons: ["RED validation proof is required before implementation"],
          },
          checkpointEvidence: [],
          fixAttempts: [],
        },
      }),
      "utf8",
    );
    const controller = createPipelineController({
      workspaceRoot: root,
      stores: {
        session: createSessionStore(root),
        checkpoints: createCheckpointStore(root),
      },
    });

    await controller.start("Yes");
    const approvedSession = await createSessionStore(root).load();

    expect(approvedSession.executionProof?.approvedScenarios).toEqual([]);
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
