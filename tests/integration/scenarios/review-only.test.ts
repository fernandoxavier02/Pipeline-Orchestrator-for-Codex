import { cp } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestRun } from "../../../src/continue/find-latest-run.js";
import { createPipelineRuntime } from "../../../src/index.js";
import { createSessionStore } from "../../../src/state/session-store.js";

describe("review-only mode", () => {
  it("runs review planning without entering implementation", { timeout: 10000 }, async () => {
    const runtime = createPipelineRuntime({
      cwd: process.cwd(),
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    expect(result.mode).toBe("review-only");
    expect(result.implementationSkipped).toBe(true);
  });

  it("does not leave a resumable confirmation session behind", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-review-only-"));
    await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });

    await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    await expect(createSessionStore(runtime.stateDir).load()).rejects.toThrow();
  });

  it("does not create a pseudo-run that shadows an existing resumable session", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-review-only-latest-run-"));
    await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const resumableRun = join(runtime.stateDir, "runs", "real-session");
    await createSessionStore(resumableRun).save({
      sessionId: "session-1",
      currentPhase: "phase-1.5",
      phase: "phase-1.5",
      batchIndex: 0,
      mode: "--complexa",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      proposal: {
        summary: "stabilize login flow",
        variant: "bugfix-heavy",
        awaitingUserConfirmation: true,
        infoGateStatus: "passed",
        designReviewStatus: "skipped",
        planModeStatus: "required",
        affectedFiles: ["src/auth/session.ts"],
        batchSize: 1,
        validationIntent: "standard",
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
      unresolvedBlockers: [],
      touchedFiles: ["src/auth/session.ts"],
    });

    await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    const latest = await findLatestRun(runtime.stateDir);

    expect(latest?.runDir).toBe(resumableRun);
  });
});
