import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";

function writeCompleteSpec(workspaceRoot: string, specId = "fluxo-pagamento") {
  const specDir = join(workspaceRoot, ".kiro", "specs", specId);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "requirements.md"), [
    "# Requirements",
    "## Critérios de aceite (ATDD)",
    "1. Primeiro critério.",
    "2. Segundo critério.",
  ].join("\n"), "utf8");
  writeFileSync(join(specDir, "design.md"), "# Design\n\n## DDD\n", "utf8");
  writeFileSync(join(specDir, "tasks.md"), "# Tasks\n\nAC coverage: AC1, AC2.\n", "utf8");

  return specDir;
}

function writeSpecContentReviewPass(specDir: string) {
  mkdirSync(join(specDir, "reviews"), { recursive: true });
  writeFileSync(join(specDir, "reviews", "spec-content-reviewer.json"), JSON.stringify({
    STATUS: "PASS",
    EVIDENCE: ["Requirements, design, and tasks agree for AC1 and AC2."],
  }), "utf8");
}

describe("spec lifecycle controller gating", () => {
  it("does not block generic non-spec heavy proposals as spec lifecycle work", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-heavy-spec-required-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    let savedSession: unknown;
    try {
      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async (session) => {
              savedSession = session;
            },
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline --complexa feature onboarding flow");

      expect(result.status).not.toBe("blocked");
      expect(result.blockedBy).not.toBe("SPEC_ARTIFACT_MISSING");
      expect(result.type).toBe("Feature");
      expect(result.variant).toBe("feature-heavy");
      expect(result.gates.map((gate: { gate: string }) => gate.gate)).not.toContain("SPEC_ARTIFACT_MISSING");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_ARTIFACT_MISSING" && entry.decision === "block")).toBe(false);
      expect((savedSession as { pendingDecision?: string } | undefined)?.pendingDecision)
        .not.toBe("spec-artifacts-required");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("allows non-spec heavy proposals only after the matching spec artifacts exist", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-heavy-spec-present-"));
    try {
      writeCompleteSpec(workspaceRoot, "feature-onboarding-flow");
      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async () => undefined,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline --complexa feature onboarding flow");

      expect(result.status).not.toBe("blocked");
      expect(result.type).toBe("Feature");
      expect(result.complexity).toBe("COMPLEXA");
      expect(result.variant).toBe("feature-heavy");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("blocks spec lifecycle proposals when required spec artifacts are missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    let savedSession: unknown;
    try {
      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async (session) => {
              savedSession = session;
            },
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("criar spec para fluxo de pagamento");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(result.type).toBe("Spec");
      expect(result.gates.map((gate: { gate: string }) => gate.gate)).toContain("SPEC_ARTIFACT_MISSING");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_ARTIFACT_MISSING" && entry.decision === "block")).toBe(true);
      expect(savedSession).toMatchObject({
        currentPhase: "phase-1",
        pendingDecision: "spec-artifacts-required",
        unresolvedBlockers: [expect.stringContaining("requirements.md")],
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("preserves spec artifact gates under force-complex mode", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    try {
      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async () => undefined,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline --complexa criar spec para fluxo de pagamento");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(result.variant).toBe("spec-heavy");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not run phase-2 traceability during the phase-1 proposal flow", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    try {
      const specDir = join(workspaceRoot, ".kiro", "specs", "fluxo-pagamento");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), [
        "# Requirements",
        "## Critérios de aceite (ATDD)",
        "1. Primeiro critério.",
        "2. Segundo critério.",
      ].join("\n"), "utf8");
      writeFileSync(join(specDir, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n\nCobre AC1.\n", "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async () => undefined,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("criar spec para fluxo de pagamento");

      expect(result.status).toBeUndefined();
      expect(result.blockedBy).toBeUndefined();
      expect(result.variant).toBe("spec-light");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits SPEC_FORMAT_GATE_FAIL when spec artifacts fail the format contract", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      writeFileSync(join(specDir, "design.md"), "Design without a heading\n", "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("criar spec para fluxo de pagamento");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_FORMAT_GATE_FAIL");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_FORMAT_GATE_FAIL" && entry.decision === "block")).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits SPEC_CONTENT_REVIEW_NOGO on continue phase-2 when content review records a no-go", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    let savedSession: unknown;
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      mkdirSync(join(specDir, "reviews"), { recursive: true });
      writeFileSync(join(specDir, "reviews", "spec-content-reviewer.json"), JSON.stringify({
        STATUS: "NO-GO",
        EVIDENCE: ["Unsupported promise remains."],
      }), "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async (session) => {
              savedSession = session;
            },
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_CONTENT_REVIEW_NOGO");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_CONTENT_REVIEW_NOGO" && entry.decision === "block")).toBe(true);
      expect(savedSession).toMatchObject({
        currentPhase: "phase-2",
        pendingDecision: "spec-content-review-required",
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits SPEC_AC_TRACEABILITY_GAP on continue phase-2 when target acceptance criteria lack traceability", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      writeSpecContentReviewPass(specDir);
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n\nCobre AC1.\n", "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_AC_TRACEABILITY_GAP");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_AC_TRACEABILITY_GAP" && entry.decision === "block")).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits SPEC_CONTENT_REVIEW_NOGO on continue phase-2 when explicit content review is missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    try {
      writeCompleteSpec(workspaceRoot);

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_CONTENT_REVIEW_NOGO");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_CONTENT_REVIEW_NOGO" && entry.decision === "block")).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps blocked Spec continue resumable after the missing content review is supplied", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    let persistedSession: any = {
      sessionId: "phase-1.5:criar spec para fluxo de pagamento",
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      batchIndex: 0,
      mode: "full",
      variant: "spec-light",
      confidenceScore: 1,
      proposal: {
        summary: "criar spec para fluxo de pagamento",
        affectedFiles: [],
        validationIntent: "standard",
        batchSize: 2,
      },
      approvalProof: {
        kind: "controller-managed-transition",
        from: "phase-1",
        to: "phase-1.5",
      },
      executionProof: {
        approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
        tddApproval: "APPROVED",
        redValidation: { status: "approved", reasons: [] },
        checkpointEvidence: [],
        fixAttempts: [],
      },
      unresolvedBlockers: [],
      touchedFiles: [],
    };
    try {
      const specDir = writeCompleteSpec(workspaceRoot);

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
            list: async () => gateEntries as any,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => persistedSession,
            save: async (session) => {
              persistedSession = session;
            },
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const firstResult = await controller.start("/pipeline continue");
      expect(firstResult.status).toBe("blocked");
      expect(firstResult.blockedBy).toBe("SPEC_CONTENT_REVIEW_NOGO");

      writeSpecContentReviewPass(specDir);

      await expect(controller.start("/pipeline continue")).resolves.toMatchObject({
        status: "blocked",
        blockedBy: "SPEC_CONTENT_REVIEW_NOGO",
        rollbackGate: "SPEC_CONTENT_REVIEW_NOGO",
        rollbackRoute: "replan",
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps SPEC_ARTIFACT_MISSING when artifacts disappear before continue phase-2 gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    try {
      const specDir = join(workspaceRoot, ".kiro", "specs", "fluxo-pagamento");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), "# Requirements\n", "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_ARTIFACT_MISSING" && entry.decision === "block")).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("emits SPEC_POST_IMPL_FAIL after execution when post-implementation validation is missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    const executionController = {
      executeApprovedWork: async () => ({
        status: "completed",
        validation: { status: "passed" },
        finalReview: { status: "approved", finalDecision: "approved" },
      }),
    };
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      writeSpecContentReviewPass(specDir);

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
        executionController,
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_POST_IMPL_FAIL");
      expect(gateEntries.some((entry) => entry.gate === "SPEC_POST_IMPL_FAIL" && entry.decision === "block")).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps SPEC_ARTIFACT_MISSING when artifacts disappear before phase-3 gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const gateEntries: Array<Record<string, unknown>> = [];
    const executionController = {
      executeApprovedWork: async () => {
        unlinkSync(join(workspaceRoot, ".kiro", "specs", "fluxo-pagamento", "design.md"));
        return {
          status: "completed",
          validation: { status: "passed" },
          finalReview: { status: "approved", finalDecision: "approved" },
        };
      },
    };
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      writeSpecContentReviewPass(specDir);

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async (entry) => {
              gateEntries.push(entry as Record<string, unknown>);
            },
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
        executionController,
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(gateEntries.some((entry) =>
        entry.gate === "SPEC_ARTIFACT_MISSING"
        && entry.phase === "phase-3"
        && entry.decision === "block"
      )).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("allows spec execution to complete when post-implementation validation has PASS evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    const executionController = {
      executeApprovedWork: async () => ({
        status: "completed",
        validation: { status: "passed" },
        finalReview: { status: "approved", finalDecision: "approved" },
      }),
    };
    try {
      const specDir = writeCompleteSpec(workspaceRoot);
      mkdirSync(join(specDir, "reviews"), { recursive: true });
      writeSpecContentReviewPass(specDir);
      writeFileSync(join(specDir, "reviews", "spec-post-impl-validator.json"), JSON.stringify({
        STATUS: "PASS",
        EVIDENCE: ["AC1 and AC2 covered by tests/spec/fluxo-pagamento.test.ts"],
      }), "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async () => undefined,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({
              sessionId: "phase-1.5:criar spec para fluxo de pagamento",
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: 0,
              mode: "full",
              variant: "spec-light",
              confidenceScore: 1,
              proposal: {
                summary: "criar spec para fluxo de pagamento",
                affectedFiles: [],
                validationIntent: "standard",
                batchSize: 2,
              },
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
              executionProof: {
                approvedScenarios: ["tests/spec/fluxo-pagamento.test.ts"],
                tddApproval: "APPROVED",
                redValidation: { status: "approved", reasons: [] },
                checkpointEvidence: [],
                fixAttempts: [],
              },
              unresolvedBlockers: [],
              touchedFiles: [],
            }),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
        executionController,
      });

      const result = await controller.start("/pipeline continue");

      expect(result.status).toBe("completed");
      expect(result.blockedBy).toBeUndefined();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("blocks the requested target spec even when an unrelated spec is complete", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pipeline-spec-controller-"));
    try {
      const unrelated = join(workspaceRoot, ".kiro", "specs", "old-complete-spec");
      const target = join(workspaceRoot, ".kiro", "specs", "fluxo-pagamento");
      mkdirSync(unrelated, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(unrelated, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(unrelated, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(unrelated, "tasks.md"), "# Tasks\n", "utf8");
      writeFileSync(join(target, "requirements.md"), "# Requirements\n", "utf8");

      const controller = createPipelineController({
        workspaceRoot,
        stores: {
          gateLog: {
            append: async () => undefined,
          },
          confidence: {
            save: async () => undefined,
          },
          session: {
            load: async () => ({}),
            save: async () => undefined,
          },
          sentinel: {
            save: async () => undefined,
          },
        },
      });

      const result = await controller.start("criar spec para fluxo de pagamento");

      expect(result.status).toBe("blocked");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(result.specPath.replace(/\\/g, "/")).toContain("/.kiro/specs/fluxo-pagamento");
      expect(result.missingArtifacts).toEqual(["design.md", "tasks.md"]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
