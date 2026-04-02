import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createExecutorController } from "../../../src/execution/executor-controller.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
async function seedExecutionProof(input) {
    await createSessionStore(input.stateDir).save({
        sessionId: "closeout-proof-session",
        runStartedAt: input.runStartedAt,
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
    for (const entry of input.gateLogEntries ?? []) {
        await createGateLog(input.stateDir).append(entry);
    }
    if (input.includeFinalReview) {
        await createGateLog(input.stateDir).append({
            gate: "FINAL_ADVERSARIAL_GATE",
            hardness: "SOFT",
            phase: "phase-3",
            decision: "pass",
            decided_by: "controller",
            timestamp: input.finalReviewTimestamp ?? "2026-04-02T12:30:00.000Z",
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
    it("persists the authoritative closeout verdict and missing evidence to session state", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-persisted-verdict-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            includeFinalReview: false,
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
        const persistedSession = await createSessionStore(runtime.stateDir).load();
        expect(result.decision).toBe("NO-GO");
        expect(persistedSession.closeout).toEqual(expect.objectContaining({
            decision: "NO-GO",
            missingEvidence: ["final-review"],
            verificationEvidence: expect.arrayContaining([
                expect.objectContaining({ kind: "build", passed: true }),
                expect.objectContaining({ kind: "tests", passed: true }),
                expect.objectContaining({ kind: "final-review", passed: false }),
            ]),
        }));
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
        const publicSessionStore = runtime.stores.session;
        const publicCheckpointStore = runtime.stores.checkpoints;
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
        const publicSessionStore = runtime.stores.session;
        const publicCheckpointStore = runtime.stores.checkpoints;
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
    it("rejects final-review evidence unless the recorded gate pass is controller-authoritative", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-non-controller-final-review-"));
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
            includeFinalReview: false,
        });
        await createGateLog(runtime.stateDir).append({
            gate: "FINAL_ADVERSARIAL_GATE",
            hardness: "SOFT",
            phase: "phase-3",
            decision: "pass",
            decided_by: "user",
            timestamp: "2026-04-02T12:30:00.000Z",
            detail: "User-supplied final review cannot authorize closeout",
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
        expect(result.missingEvidence).toEqual(["final-review"]);
    });
    it("does not inherit a stale final-review pass from an older run that shares the same stateDir", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-stale-pass-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            runStartedAt: "2026-04-01T12:00:00.000Z",
            includeFinalReview: true,
            finalReviewTimestamp: "2026-04-01T12:30:00.000Z",
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            runStartedAt: "2026-04-02T12:00:00.000Z",
            includeFinalReview: false,
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
        expect(result.missingEvidence).toEqual(["final-review"]);
    });
    it("does not inherit a stale blocking gate from an older run that shares the same stateDir", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-stale-block-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            runStartedAt: "2026-04-01T12:00:00.000Z",
            gateLogEntries: [
                {
                    gate: "CHECKPOINT_FAIL",
                    hardness: "HARD",
                    phase: "phase-2",
                    decision: "block",
                    decided_by: "controller",
                    timestamp: "2026-04-01T12:01:00.000Z",
                    detail: "Older run hit a checkpoint failure",
                    confidence_impact: 0,
                },
            ],
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            runStartedAt: "2026-04-02T12:00:00.000Z",
            includeFinalReview: true,
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
        expect(result.decision).toBe("GO");
        expect(result.blockingGates).toEqual([]);
    });
    it("isolates stale gate history for legacy sessions by deriving scope from current checkpoints", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-legacy-scope-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            runStartedAt: "2026-04-01T12:00:00.000Z",
            includeFinalReview: false,
            gateLogEntries: [
                {
                    gate: "CHECKPOINT_FAIL",
                    hardness: "HARD",
                    phase: "phase-2",
                    decision: "block",
                    decided_by: "controller",
                    timestamp: "2026-04-01T12:10:00.000Z",
                    detail: "Legacy stale blocker from an older run",
                    confidence_impact: 0,
                },
                {
                    gate: "FINAL_ADVERSARIAL_GATE",
                    hardness: "SOFT",
                    phase: "phase-3",
                    decision: "pass",
                    decided_by: "controller",
                    timestamp: "2026-04-01T12:20:00.000Z",
                    detail: "Legacy stale final review from an older run",
                    confidence_impact: 0,
                },
            ],
        });
        await seedExecutionProof({
            stateDir: runtime.stateDir,
            batches: ["batch-1"],
            includeFinalReview: false,
        });
        await createCheckpointStore(runtime.stateDir).save({
            name: "batch-1",
            phase: "phase-2",
            batchIndex: 0,
            status: "completed",
            timestamp: "2026-04-02T12:10:00.000Z",
            detail: "Current legacy-session checkpoint anchors closeout scope",
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
        expect(result.blockingGates).toEqual([]);
        expect(result.missingEvidence).toEqual(["final-review"]);
    });
    it("clears a recoverable checkpoint block when a later controller pass resolves the gate", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-recovered-gate-"));
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
            detail: "Controller revalidated the checkpoint successfully",
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
        expect(result.decision).toBe("GO");
        expect(result.blockingGates).toEqual([]);
    });
    it("reaches GO from the controller execution handoff after a successful final adversarial review without manual gate seeding", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-runtime-final-review-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        const executionController = createExecutorController({
            runBatch: (async () => ({
                execution: {
                    mode: "single-agent",
                    role: "executor-implementer",
                    output: {
                        changedFiles: ["src/index.ts"],
                        verificationEvidence: {
                            scenarios: ["tests/proof/batch-1.test.ts"],
                        },
                    },
                },
                review: {
                    status: "approved",
                    findings: [],
                    batch: "batch-1",
                    files: ["src/index.ts"],
                    changedDomains: [],
                    checklists: [],
                    required: true,
                    gate: "ADVERSARIAL_GATE",
                    decision: "pass",
                    strategy: "approved-review",
                },
                changedFiles: ["src/index.ts"],
                verificationEvidence: {
                    scenarios: ["tests/proof/batch-1.test.ts"],
                },
            })),
            preTester: {
                collectFailures: () => [],
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/proof/batch-1.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: ["Controller approved RED proof"],
                    },
                }),
                validateRedState: () => ({
                    status: "approved",
                    reasons: ["Controller approved RED proof"],
                }),
            },
            checkpointValidator: {
                reset() { },
                validateCheckpoints: ({ checkpointName }) => ({
                    status: "passed",
                    consecutiveFailures: 0,
                    requiredCheckpoints: 1,
                    verifiedCheckpoints: 1,
                    coverage: 1,
                    checkpointName,
                }),
            },
            finalAdversarialOrchestrator: async () => ({
                status: "approved",
                finalDecision: "approved",
                findings: [],
            }),
        });
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: createSessionStore(runtime.stateDir),
                checkpoints: createCheckpointStore(runtime.stateDir),
                gateLog: createGateLog(runtime.stateDir),
                confidence: createConfidenceScoreStore(runtime.stateDir),
            },
            executionController,
        });
        await createSessionStore(runtime.stateDir).save({
            sessionId: "runtime-final-review-proof",
            runStartedAt: new Date(Date.now() - 1_000).toISOString(),
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "--complexa",
            variant: "bugfix-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "stabilize closeout handoff",
                variant: "bugfix-heavy",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "required",
                affectedFiles: ["src/index.ts"],
                batchSize: 1,
                validationIntent: "standard",
            },
            approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
            },
            executionProof: {
                approvedScenarios: ["tests/proof/batch-1.test.ts"],
                tddApproval: "APPROVED",
                redValidation: {
                    status: "approved",
                    reasons: ["Controller approved RED proof"],
                },
                checkpointEvidence: [],
                fixAttempts: [],
            },
            unresolvedBlockers: [],
            touchedFiles: ["src/index.ts"],
        });
        const executionResult = await controller.start("/pipeline continue");
        const gateLogEntries = await createGateLog(runtime.stateDir).list();
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
        expect(executionResult.status).toBe("completed");
        expect(gateLogEntries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "FINAL_ADVERSARIAL_GATE",
                decision: "pass",
            }),
        ]));
        expect(result.decision).toBe("GO");
        expect(result.missingEvidence).toEqual([]);
    });
    it("does not let an injected non-authoritative execution controller mint final-review proof", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-closeout-spoofed-final-review-"));
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: createSessionStore(runtime.stateDir),
                checkpoints: createCheckpointStore(runtime.stateDir),
                gateLog: createGateLog(runtime.stateDir),
                confidence: createConfidenceScoreStore(runtime.stateDir),
            },
            executionController: {
                executeApprovedWork: async () => ({
                    status: "completed",
                    proof: {
                        approvedScenarios: ["tests/proof/batch-1.test.ts"],
                        tddApproval: "APPROVED",
                        redValidation: {
                            status: "approved",
                            reasons: ["Controller approved RED proof"],
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
                    batches: [{ name: "batch-1", tasks: ["src/index.ts"] }],
                    finalReview: {
                        status: "approved",
                        finalDecision: "approved",
                        findings: [],
                    },
                }),
            },
        });
        await createSessionStore(runtime.stateDir).save({
            sessionId: "spoofed-final-review-proof",
            runStartedAt: new Date(Date.now() - 1_000).toISOString(),
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "--complexa",
            variant: "bugfix-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "reject spoofed final-review authority",
                variant: "bugfix-heavy",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "required",
                affectedFiles: ["src/index.ts"],
                batchSize: 1,
                validationIntent: "standard",
            },
            approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
            },
            executionProof: {
                approvedScenarios: ["tests/proof/batch-1.test.ts"],
                tddApproval: "APPROVED",
                redValidation: {
                    status: "approved",
                    reasons: ["Controller approved RED proof"],
                },
                checkpointEvidence: [],
                fixAttempts: [],
            },
            unresolvedBlockers: [],
            touchedFiles: ["src/index.ts"],
        });
        const executionResult = await controller.start("/pipeline continue");
        const gateLogEntries = await createGateLog(runtime.stateDir).list();
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
        expect(executionResult.status).toBe("completed");
        expect(gateLogEntries).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "FINAL_ADVERSARIAL_GATE",
                decision: "pass",
            }),
        ]));
        expect(result.decision).toBe("NO-GO");
        expect(result.missingEvidence).toEqual(["final-review"]);
    });
});
