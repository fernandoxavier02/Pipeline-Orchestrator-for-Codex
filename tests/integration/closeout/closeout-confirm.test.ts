import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPipelineRuntime } from "../../../src/index.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";

async function seedExecutionProof(input: {
  stateDir: string;
  batches: string[];
  includeFinalReview?: boolean;
}) {
  await createSessionStore(input.stateDir).save({
    sessionId: "closeout-proof-session",
    currentPhase: "phase-3",
    phase: "phase-3",
    batchIndex: Math.max(0, input.batches.length - 1),
    mode: "full",
    variant: "bugfix-heavy",
    confidenceScore: 1,
    unresolvedBlockers: [],
    touchedFiles: ["src/index.ts"],
    executionProof: {
      approvedScenarios: input.batches.map((batch) => `tests/proof/${batch}.test.ts`),
      tddApproval: "APPROVED",
      redValidation: {
        status: "approved",
        reasons: ["Controller approved RED proof"],
      },
      checkpointEvidence: input.batches.map((batch) => ({
        batchName: batch,
        requiredCheckpoints: 1,
        verifiedCheckpoints: 1,
        evidence: [`tests/proof/${batch}.test.ts`],
      })),
      fixAttempts: [],
    },
  });

  if (input.includeFinalReview) {
    await createGateLog(input.stateDir).append({
      gate: "FINAL_ADVERSARIAL_GATE",
      hardness: "SOFT",
      phase: "phase-3",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-02T12:30:00.000Z",
      detail: "Controller recorded final adversarial approval.",
      confidence_impact: 0,
    });
  }
}

describe("closeout confirmation", () => {
  it("logs CLOSEOUT_CONFIRM as a skipped SOFT gate when operator confirmation is omitted", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-skip-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Authoritative checkpoint proof",
    });
    await seedExecutionProof({
      stateDir: runtime.stateDir,
      batches: ["batch-1"],
      includeFinalReview: true,
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true },
        { kind: "tests", passed: true },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      confirmed: false,
    });

    const rawGateLog = await readFile(join(runtime.stateDir, "gate-decisions.jsonl"), "utf8");

    expect(result.decision).toBe("CONDITIONAL");
    expect(result.text).toContain("Skipped SOFT gates: CLOSEOUT_CONFIRM");
    expect(rawGateLog).toContain('"gate":"CLOSEOUT_CONFIRM"');
    expect(rawGateLog).toContain('"decision":"skip"');
  });

  it("surfaces rollback guidance and verification evidence in closeout output", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-block-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Authoritative checkpoint proof",
    });
    await seedExecutionProof({
      stateDir: runtime.stateDir,
      batches: ["batch-1"],
      includeFinalReview: true,
    });
    const gateLog = createGateLog(runtime.stateDir);

    await gateLog.append({
      gate: "CHECKPOINT_FAIL",
      hardness: "HARD",
      phase: "phase-2",
      decision: "block",
      decided_by: "controller",
      timestamp: "2026-04-02T15:00:00.000Z",
      detail: "Checkpoint validation failed before closeout",
      confidence_impact: 0,
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      confirmed: true,
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.text).toContain("Rollback hint: revalidate");
    expect(result.text).toContain("Verification evidence: npm run build, npm test, final adversarial review");
    expect(result.text).toContain("Confidence:");
  });

  it("recomputes closeout from the latest confirmation instead of preserving a previous skipped confirmation", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-idempotent-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Authoritative checkpoint proof",
    });
    await seedExecutionProof({
      stateDir: runtime.stateDir,
      batches: ["batch-1"],
      includeFinalReview: true,
    });

    const first = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true },
        { kind: "tests", passed: true },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      confirmed: false,
    });

    const second = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true },
        { kind: "tests", passed: true },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      confirmed: true,
    });

    expect(first.decision).toBe("CONDITIONAL");
    expect(second.decision).toBe("GO");
    expect(second.skippedSoftGates).toEqual([]);
    expect(second.confidenceScore).toBe(1);
  });

  it("refuses GO when caller-supplied evidence is not backed by authoritative runtime checkpoints", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-fabricated-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "fabricated build" },
        { kind: "tests", passed: true, label: "fabricated tests" },
        { kind: "final-review", passed: true, label: "fabricated final review" },
      ],
      confirmed: true,
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(["build", "tests", "final-review"]);
  });

  it("refuses standard GO when checkpoint completion exists but controller-owned execution proof is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-checkpoint-proxy-standard-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Completed checkpoint without controller-owned execution proof",
    });
    await createGateLog(runtime.stateDir).append({
      gate: "FINAL_ADVERSARIAL_GATE",
      hardness: "SOFT",
      phase: "phase-3",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-02T12:30:00.000Z",
      detail: "Final adversarial review was recorded separately.",
      confidence_impact: 0,
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "fabricated build" },
        { kind: "tests", passed: true, label: "fabricated tests" },
        { kind: "final-review", passed: true, label: "recorded final review" },
      ],
      confirmed: true,
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(["build", "tests"]);
  });

  it("refuses reduced GO when checkpoint completion exists but controller-owned execution proof is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-checkpoint-proxy-reduced-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Completed checkpoint without controller-owned execution proof",
    });

    const result = await runtime.closeout.finalize({
      mode: "--hotfix",
      validationIntent: "reduced",
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "fabricated build" },
        { kind: "tests", passed: true, label: "fabricated tests" },
      ],
      confirmed: true,
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(["build", "tests"]);
  });

  it("does not allow the public runtime stores surface to forge standard closeout proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-public-store-standard-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const publicSessionStore = runtime.stores.session as {
      load: () => Promise<unknown>;
      save?: (session: unknown) => Promise<void>;
    };
    const publicCheckpointStore = runtime.stores.checkpoints as {
      list: () => Promise<unknown>;
      save?: (checkpoint: unknown) => Promise<void>;
    };

    await publicCheckpointStore.save?.({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Forged public checkpoint",
    });
    await publicSessionStore.save?.({
      sessionId: "forged-public-session",
      currentPhase: "phase-3",
      phase: "phase-3",
      batchIndex: 0,
      mode: "full",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      unresolvedBlockers: [],
      touchedFiles: ["src/index.ts"],
      executionProof: {
        approvedScenarios: ["tests/proof/batch-1.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: ["Forged via public surface"],
        },
        checkpointEvidence: [
          {
            batchName: "batch-1",
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            evidence: ["tests/proof/batch-1.test.ts"],
          },
        ],
        fixAttempts: [],
      },
    });
    await createGateLog(runtime.stateDir).append({
      gate: "FINAL_ADVERSARIAL_GATE",
      hardness: "SOFT",
      phase: "phase-3",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-02T12:30:00.000Z",
      detail: "Forged final review outside the public runtime surface",
      confidence_impact: 0,
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "fabricated build" },
        { kind: "tests", passed: true, label: "fabricated tests" },
        { kind: "final-review", passed: true, label: "forged final review" },
      ],
      confirmed: true,
    });

    expect("save" in runtime.stores.session).toBe(false);
    expect("save" in runtime.stores.checkpoints).toBe(false);
    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(["build", "tests"]);
  });

  it("does not allow the public runtime stores surface to forge reduced closeout proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-public-store-reduced-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const publicSessionStore = runtime.stores.session as {
      load: () => Promise<unknown>;
      save?: (session: unknown) => Promise<void>;
    };
    const publicCheckpointStore = runtime.stores.checkpoints as {
      list: () => Promise<unknown>;
      save?: (checkpoint: unknown) => Promise<void>;
    };

    await publicCheckpointStore.save?.({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Forged public checkpoint",
    });
    await publicSessionStore.save?.({
      sessionId: "forged-public-hotfix-session",
      currentPhase: "phase-3",
      phase: "phase-3",
      batchIndex: 0,
      mode: "--hotfix",
      variant: "bugfix-heavy",
      confidenceScore: 1,
      unresolvedBlockers: [],
      touchedFiles: ["src/index.ts"],
      executionProof: {
        approvedScenarios: ["tests/proof/batch-1.test.ts"],
        tddApproval: "APPROVED",
        redValidation: {
          status: "approved",
          reasons: ["Forged via public surface"],
        },
        checkpointEvidence: [
          {
            batchName: "batch-1",
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            evidence: ["tests/proof/batch-1.test.ts"],
          },
        ],
        fixAttempts: [],
      },
    });

    const result = await runtime.closeout.finalize({
      mode: "--hotfix",
      validationIntent: "reduced",
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "fabricated build" },
        { kind: "tests", passed: true, label: "fabricated tests" },
      ],
      confirmed: true,
    });

    expect("save" in runtime.stores.session).toBe(false);
    expect("save" in runtime.stores.checkpoints).toBe(false);
    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(["build", "tests"]);
  });

  it("keeps a blocking gate effective even when a later duplicate gate entry says pass", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-duplicate-gate-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    await createCheckpointStore(runtime.stateDir).save({
      name: "batch-1",
      phase: "phase-2",
      batchIndex: 0,
      status: "completed",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Authoritative checkpoint proof",
    });
    await seedExecutionProof({
      stateDir: runtime.stateDir,
      batches: ["batch-1"],
      includeFinalReview: true,
    });
    const gateLog = createGateLog(runtime.stateDir);

    await gateLog.append({
      gate: "CHECKPOINT_FAIL",
      hardness: "HARD",
      phase: "phase-2",
      decision: "block",
      decided_by: "controller",
      timestamp: "2026-04-02T12:00:00.000Z",
      detail: "Checkpoint failed",
      confidence_impact: 0,
    });
    await gateLog.append({
      gate: "CHECKPOINT_FAIL",
      hardness: "HARD",
      phase: "phase-2",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-02T12:05:00.000Z",
      detail: "A later duplicate pass must not erase the block",
      confidence_impact: 0,
    });

    const result = await runtime.closeout.finalize({
      reviews: [{ status: "approved" }],
      batches: [{ name: "batch-1" }],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      confirmed: true,
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.blockingGates).toEqual(["CHECKPOINT_FAIL"]);
  });
});
