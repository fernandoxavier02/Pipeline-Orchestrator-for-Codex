import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntimeUnavailableError } from "../../../src/dispatcher/run-role.js";
import { createPipelineRuntime } from "../../../src/index.js";

describe("pipeline execution", () => {
  it("blocks operational public command dispatch by default when no real agent adapter is available", async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: process.cwd(),
    });

    await expect(runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "information-gate",
      phase: "phase-0",
      prompt: "Ask one question at a time.",
      input: { request: "/pipeline-orchestrator-for-codex:pipeline audit current agents" },
      expectedOutput: ["INFORMATION_GATE", "STATUS"],
      ownership: ["agents/core/information-gate.md"],
      freshContext: true,
    })).rejects.toThrow(AgentRuntimeUnavailableError);
  });

  it("blocks strict runtime dispatch when no real agent adapter is available", async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: process.cwd(),
      strictAgents: true,
    });

    await expect(runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "information-gate",
      phase: "phase-0",
      prompt: "Ask one question at a time.",
      input: { request: "/pipeline audit current agents" },
      expectedOutput: ["INFORMATION_GATE", "STATUS"],
      ownership: ["agents/core/information-gate.md"],
      freshContext: true,
    })).rejects.toThrow(AgentRuntimeUnavailableError);
  });

  it("loads bundled prompt contracts when runtime cwd is an external project workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pipeline-external-workspace-"));
    try {
      const runtime = createPipelineRuntime({
        cwd: workspace,
        codexHome: workspace,
      });

      const result = await runtime.dispatcher.runRole({
        mode: "parallel-emulation",
        role: "review-orchestrator",
        prompt: "Coordinate a read-only external workspace smoke review.",
        input: { request: "review external workspace prompt root resolution" },
        team: [
          {
            role: "quality-reviewer",
            prompt: "Return an approved read-only smoke review.",
            input: { request: "external workspace prompt root resolution" },
            reviewOnly: true,
          },
        ],
        reviewOnly: true,
      });

      expect(result.mode).toBe("parallel-emulation");
      expect(result.output).toMatchObject({
        status: "approved",
        reviewOnly: true,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("builds batches, runs review, and returns a closeout summary", async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("implement audit-friendly continue mode");

    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it("runs a batch through adversarial review and final validation", async () => {
    const { buildBatches } = await import("../../../src/execution/build-batches.js");
    const { runAdversarialReview } = await import("../../../src/review/adversarial-review.js");
    const { runFinalValidator } = await import("../../../src/validation/final-validator.js");

    const batches = buildBatches({
      files: ["src/controller/pipeline-controller.ts", "src/state/session-store.ts"],
    });
    const review = await runAdversarialReview({
      batch: batches[0],
      findings: [],
    });
    const final = runFinalValidator({
      reviews: [review],
      confidenceScore: 0.91,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
    });

    expect(final.decision).toBe("GO");
  });

  it("consults the validated executor prompt file in the runtime dispatcher path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-executor-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "executor", "executor-implementer.md"),
        `# Executor Implementer

Implement only the current batch.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "executor-implementer",
        prompt: "inline executor prompt should not be trusted",
        input: {
          batch: {
            name: "batch-1",
            files: ["src/index.ts"],
          },
        },
      })).rejects.toThrow(/required output block|CHANGES|TESTS|RISKS/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consults the validated reviewer prompt file in the runtime dispatcher path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-reviewer-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", "adversarial-reviewer.md"),
        `# Adversarial Reviewer

Review from fresh context.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "batch-reviewer",
        prompt: "inline reviewer prompt should not be trusted",
        input: {
          batch: {
            name: "batch-1",
            files: ["src/index.ts"],
          },
          files: ["src/index.ts"],
          changedDomains: ["auth"],
          reviewOnly: true,
        },
        freshContext: true,
        reviewOnly: true,
      })).rejects.toThrow(/required output block|FINDINGS|SEVERITY|EVIDENCE|NEXT_ACTION/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consults the validated pre-tester prompt file in the runtime dispatcher path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-pre-tester-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", "pre-tester.md"),
        `# Pre Tester

Write tests first.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "pre-tester",
        prompt: "inline pre-tester prompt should not be trusted",
        input: {
          approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
          cwd: root,
        },
        filesInScope: ["src/index.ts"],
        authorityLevel: "controller",
        freshContext: true,
      })).rejects.toThrow(/pre-tester|required output block|PRE_TESTER_RESULT|STATUS|EVIDENCE|NEXT_ACTION/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consults the validated final security reviewer prompt file in the runtime dispatcher path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-security-reviewer-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", "security-reviewer.md"),
        `# Security Reviewer

Review the final scope from fresh context.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "security-reviewer",
        prompt: "inline security reviewer prompt should not be trusted",
        input: {
          scope: {
            files: ["src/auth/session.ts"],
          },
          files: ["src/auth/session.ts"],
          changedDomains: ["auth"],
          reviewOnly: true,
        },
        freshContext: true,
        reviewOnly: true,
      })).rejects.toThrow(/required output block|FINDINGS|SEVERITY|EVIDENCE|NEXT_ACTION/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consults the validated review orchestrator prompt file in the runtime dispatcher path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-review-orchestrator-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", "review-orchestrator.md"),
        `# Review Orchestrator

Coordinate the review team.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "parallel-emulation",
        role: "review-orchestrator",
        prompt: "inline review orchestrator prompt should not be trusted",
        input: {
          batch: {
            name: "batch-1",
            files: ["src/index.ts"],
          },
          files: ["src/index.ts"],
          changedDomains: ["auth"],
          reviewOnly: true,
        },
        filesInScope: ["src/index.ts"],
        authorityLevel: "controller",
        reviewOnly: true,
        freshContext: true,
        team: [
          {
            role: "batch-reviewer",
            prompt: "review this batch",
            input: {
              batch: {
                name: "batch-1",
                files: ["src/index.ts"],
              },
              files: ["src/index.ts"],
              changedDomains: ["auth"],
              reviewOnly: true,
            },
            filesInScope: ["src/index.ts"],
            authorityLevel: "reviewer",
            reviewOnly: true,
            freshContext: true,
          },
        ],
      })).rejects.toThrow(/required output block|STATUS|FINDINGS|REVIEWERS|STRATEGY/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consults validated child reviewer prompt files in the runtime multi-agent path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-child-reviewer-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "executor", "executor-spec-reviewer.md"),
        `# Executor Spec Reviewer

Check requirement compliance directly from the changed files.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "parallel-emulation",
        role: "review-orchestrator",
        prompt: "inline review orchestrator prompt should not be trusted",
        input: {
          batch: {
            name: "batch-1",
            files: ["src/index.ts"],
          },
          files: ["src/index.ts"],
          changedDomains: ["auth"],
          reviewOnly: true,
        },
        filesInScope: ["src/index.ts"],
        authorityLevel: "controller",
        reviewOnly: true,
        freshContext: true,
        team: [
          {
            role: "executor-spec-reviewer",
            prompt: "review requirements from inline text only",
            input: {
              batch: {
                name: "batch-1",
                files: ["src/index.ts"],
              },
              files: ["src/index.ts"],
              changedDomains: ["auth"],
              reviewOnly: true,
            },
            filesInScope: ["src/index.ts"],
            authorityLevel: "reviewer",
            reviewOnly: true,
            freshContext: true,
          },
        ],
      })).rejects.toThrow(/executor-spec-reviewer|required output block|SPEC_REVIEW_RESULT|STATUS|EVIDENCE|NEXT_ACTION/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["spec-format-gate", "spec-format-gate.md", /quality\/spec-format-gate|required output block/i],
    ["spec-content-reviewer", "spec-content-reviewer.md", /quality\/spec-content-reviewer|required output block/i],
    ["spec-post-impl-validator", "spec-post-impl-validator.md", /quality\/spec-post-impl-validator|required output block/i],
    ["spec-closer", "spec-closer.md", /quality\/spec-closer|required output block/i],
  ])("consults the validated %s prompt file in the runtime dispatcher path", async (role, fileName, expectedError) => {
    const root = await mkdtemp(join(tmpdir(), `pipeline-runtime-${role}-prompt-`));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", fileName),
        `# ${role}

Review the spec lifecycle step.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.dispatcher.runRole({
        mode: "single-agent",
        role,
        prompt: "inline spec prompt should not be trusted",
        input: {
          specPath: ".kiro/specs/fluxo-pagamento",
          files: ["requirements.md", "design.md", "tasks.md"],
        },
        freshContext: true,
      })).rejects.toThrow(expectedError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails controller startup when the design interrogator prompt contract is broken", { timeout: 10000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-design-interrogator-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "quality", "design-interrogator.md"),
        `# Design Interrogator

Resolve design trade-offs before implementation.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.controller.start("implement audit-friendly continue mode")).rejects.toThrow(
        /design-interrogator|required output block|DESIGN_INTERROGATION|STATUS|DECISIONS|QUESTION/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails controller startup when the sentinel prompt contract is broken", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runtime-sentinel-prompt-"));

    try {
      await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
      await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
      await writeFile(
        join(root, "prompts", "agents", "core", "sentinel.md"),
        `# Sentinel

Protect the expected pipeline sequence.
`,
        "utf8",
      );

      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
      });

      await expect(runtime.controller.start("implement audit-friendly continue mode")).rejects.toThrow(
        /sentinel|required output block|SENTINEL_DECISION|STATUS|EXPECTED_NEXT|ACTION/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
