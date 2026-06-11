import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createExecutorController } from "../../../src/execution/executor-controller.js";
import { createPreTester } from "../../../src/execution/pre-tester.js";
import { createQualityGateRouter } from "../../../src/execution/quality-gate-router.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createConfidenceScoreStore } from "../../../src/state/confidence-score.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
function createCheckpointValidatorDispatch(checkpointName = "batch-1") {
    return {
        mode: "single-agent",
        role: "checkpoint-validator",
        output: {
            CHECKPOINT_RESULT: checkpointName,
            STATUS: "passed",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "continue",
            status: "passed",
            checkpointName,
            consecutiveFailures: 0,
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
            coverage: 1,
            evidence: ["tests/unit/controller/pipeline-controller.test.ts"],
        },
    };
}
function createPreTesterDispatch() {
    return {
        mode: "single-agent",
        role: "pre-tester",
        output: {
            PRE_TESTER_RESULT: "approved-proof",
            STATUS: "approved",
            EVIDENCE: ["tests/unit/controller/pipeline-controller.test.ts"],
            NEXT_ACTION: "proceed-to-batch",
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            tddApproval: "APPROVED",
            redValidation: {
                status: "approved",
                reasons: ["RED validation passed for approved scenarios"],
            },
        },
    };
}
describe("execution controller routing", () => {
    it("blocks execution when TDD approval is missing", async () => {
        const runBatch = vi.fn();
        const controller = createExecutorController({
            runBatch,
            qualityGateRouter: createQualityGateRouter(),
            preTester: createPreTester(),
            checkpointValidator: {
                validateCheckpoints: vi.fn(),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            approvedScenarios: [],
            tddApproval: "REJECTED",
            redValidation: {
                status: "blocked",
                reasons: ["approved test scenarios must come first"],
            },
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("TDD_APPROVAL");
        expect(runBatch).not.toHaveBeenCalled();
    });
    it("rejects fabricated approved proof when no controller-owned scenarios were supplied", async () => {
        const runBatch = vi.fn();
        const controller = createExecutorController({
            runBatch,
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            tddApproval: "APPROVED",
            redValidation: {
                status: "approved",
                reasons: ["fabricated"],
            },
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("TDD_APPROVAL");
        expect(result.proof.approvedScenarios).toEqual([]);
        expect(runBatch).not.toHaveBeenCalled();
    });
    it("rejects non-test scenarios as invalid RED proof inputs", async () => {
        const runBatch = vi.fn();
        const controller = createExecutorController({
            runBatch,
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            approvedScenarios: ["src/controller/pipeline-controller.ts"],
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("TDD_APPROVAL");
        expect(result.proof.approvedScenarios).toEqual([]);
        expect(result.proof.redValidation.reasons).toEqual(expect.arrayContaining([
            expect.stringContaining("not a real test proof input"),
        ]));
        expect(runBatch).not.toHaveBeenCalled();
    });
    it("rejects red validation when syntax or import failures are present", async () => {
        const tester = createPreTester();
        const result = tester.validateRedState({
            approvedScenarios: ["happy path"],
            failures: [
                {
                    kind: "syntax",
                    file: "src/execution/run-batch.ts",
                    message: "Unexpected token",
                },
                {
                    kind: "import",
                    file: "src/execution/executor-controller.ts",
                    message: "Cannot find module",
                },
            ],
        });
        expect(result.status).toBe("blocked");
        expect(result.reasons).toEqual(expect.arrayContaining([
            expect.stringContaining("syntax"),
            expect.stringContaining("import"),
        ]));
    });
    it("sizes batches adaptively across the SSOT complexity levels", () => {
        const router = createQualityGateRouter();
        expect(router.planBatches({
            complexity: "SIMPLES",
            tasks: ["a", "b", "c"],
        }).batches).toEqual([
            {
                name: "batch-1",
                tasks: ["a", "b", "c"],
                parallel_eligible: false,
                parallel_reason: "SIMPLES runs as one serial batch.",
            },
        ]);
        expect(router.planBatches({
            complexity: "MEDIA",
            tasks: ["a", "b", "c", "d", "e"],
        }).batches.map((batch) => batch.tasks.length)).toEqual([3, 2]);
        expect(router.planBatches({
            complexity: "COMPLEXA",
            tasks: ["a", "b", "c"],
        }).batches.map((batch) => batch.tasks.length)).toEqual([1, 1, 1]);
    });
    it("dispatches checkpoint validation through the runtime role and consumes its structured result", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role }) => {
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            return createCheckpointValidatorDispatch("batch-1");
        });
        const controller = createExecutorController({
            runBatch: vi.fn().mockResolvedValue({
                execution: {
                    status: "implemented",
                },
                changedFiles: ["src/controller/pipeline-controller.ts"],
                review: {
                    status: "approved",
                },
                verificationEvidence: {
                    scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                },
            }),
            reviewOrchestrator: {
                reviewBatch: vi.fn().mockResolvedValue({
                    status: "approved",
                    findings: [],
                }),
            },
            finalAdversarialOrchestrator: vi.fn().mockResolvedValue({
                status: "approved",
                finalDecision: "approved",
                findings: [],
            }),
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
            runRole,
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            mode: "--complexa",
            proposal: {
                summary: "stabilize login flow",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(runRole).toHaveBeenCalledWith(expect.objectContaining({
            mode: "single-agent",
            role: "checkpoint-validator",
            authorityLevel: "controller",
            filesInScope: ["src/controller/pipeline-controller.ts"],
        }));
        expect(result.validation).toEqual(expect.objectContaining({
            status: "passed",
            checkpointName: "batch-1",
            requiredCheckpoints: 1,
            verifiedCheckpoints: 1,
        }));
    });
    it("dispatches pre-tester through the runtime role and consumes its structured proof", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            throw new Error(`Unexpected role ${role}`);
        });
        const controller = createExecutorController({
            runBatch: vi.fn().mockResolvedValue({
                execution: {
                    status: "implemented",
                },
                changedFiles: ["src/controller/pipeline-controller.ts"],
                review: {
                    status: "approved",
                },
                verificationEvidence: {
                    scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                },
            }),
            reviewOrchestrator: {
                reviewBatch: vi.fn().mockResolvedValue({
                    status: "approved",
                    findings: [],
                }),
            },
            finalAdversarialOrchestrator: vi.fn().mockResolvedValue({
                status: "approved",
                finalDecision: "approved",
                findings: [],
            }),
            runRole,
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            mode: "--complexa",
            proposal: {
                summary: "stabilize login flow",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(runRole).toHaveBeenNthCalledWith(1, expect.objectContaining({
            mode: "single-agent",
            role: "pre-tester",
            authorityLevel: "controller",
            filesInScope: ["src/controller/pipeline-controller.ts"],
        }));
        expect(result.proof).toEqual(expect.objectContaining({
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            tddApproval: "APPROVED",
            redValidation: {
                status: "approved",
                reasons: ["RED validation passed for approved scenarios"],
            },
        }));
    });
    it("dispatches quality-gate-router through the runtime role and consumes its structured batch plan", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "quality-gate-router") {
                return {
                    mode: "single-agent",
                    role: "quality-gate-router",
                    output: {
                        QUALITY_GATE_PLAN: "planned-batches",
                        STATUS: "planned",
                        EVIDENCE: ["a", "b", "c", "d"],
                        NEXT_ACTION: "proceed-to-pre-tester",
                        batchSize: 3,
                        regressionProofs: 2,
                        approvedScenarios: ["a", "b", "c", "d"],
                        batches: [
                            { name: "batch-1", tasks: ["a", "b", "c"] },
                            { name: "batch-2", tasks: ["d"] },
                        ],
                    },
                };
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            throw new Error(`Unexpected role ${role}`);
        });
        const controller = createExecutorController({
            runBatch: vi.fn().mockResolvedValue({
                execution: {
                    status: "implemented",
                },
                changedFiles: ["a", "b", "c"],
                review: {
                    status: "approved",
                },
                verificationEvidence: {
                    scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                },
            }),
            reviewOrchestrator: {
                reviewBatch: vi.fn().mockResolvedValue({
                    status: "approved",
                    findings: [],
                }),
            },
            finalAdversarialOrchestrator: vi.fn().mockResolvedValue({
                status: "approved",
                finalDecision: "approved",
                findings: [],
            }),
            runRole,
        });
        const result = await controller.executeApprovedWork({
            tasks: ["a", "b", "c", "d"],
            complexity: "MEDIA",
            proposal: {
                summary: "stabilize batch routing",
                affectedFiles: ["a", "b", "c", "d"],
                validationIntent: "standard",
                batchSize: 3,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(runRole).toHaveBeenNthCalledWith(1, expect.objectContaining({
            mode: "single-agent",
            role: "quality-gate-router",
            authorityLevel: "controller",
            filesInScope: ["a", "b", "c", "d"],
        }));
        expect(result.batches).toEqual([
            { name: "batch-1", tasks: ["a", "b", "c"] },
            { name: "batch-2", tasks: ["d"] },
        ]);
        expect(result.execution).toEqual(expect.objectContaining({
            batchSize: 3,
            regressionProofs: 2,
        }));
    });
    it("routes approved work through execution, review, checkpoint, and validation", async () => {
        const executionController = {
            executeApprovedWork: vi.fn().mockResolvedValue({
                status: "completed",
                execution: {
                    batchSize: 1,
                },
                review: {
                    status: "approved",
                },
                validation: {
                    status: "go",
                },
            }),
        };
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => ({
                        sessionId: "session-1",
                        currentPhase: "phase-1.5",
                        phase: "phase-1.5",
                        batchIndex: 0,
                        mode: "full",
                        variant: "bugfix-heavy",
                        confidenceScore: 1,
                        proposal: {
                            summary: "stabilize login flow",
                            variant: "bugfix-heavy",
                            awaitingUserConfirmation: true,
                            infoGateStatus: "passed",
                            designReviewStatus: "skipped",
                            planModeStatus: "required",
                            affectedFiles: ["src/controller/pipeline-controller.ts"],
                            batchSize: 1,
                            validationIntent: "standard",
                        },
                        approvalProof: {
                            kind: "controller-managed-transition",
                            from: "phase-1",
                            to: "phase-1.5",
                        },
                        unresolvedBlockers: [],
                        touchedFiles: ["src/controller/pipeline-controller.ts"],
                    }),
                },
                checkpoints: {
                    list: async () => [],
                },
            },
            executionController,
        });
        const result = await controller.start("/pipeline continue");
        expect(executionController.executeApprovedWork).toHaveBeenCalledWith(expect.objectContaining({
            phase: "phase-1.5",
            proposal: expect.objectContaining({
                summary: "stabilize login flow",
            }),
        }));
        expect(result.status).toBe("completed");
        expect(result.review.status).toBe("approved");
        expect(result.validation.status).toBe("go");
    });
    it("advances the real approval flow into execution once controller proof is promoted", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-controller-routing-"));
        const runBatch = vi.fn();
        const controller = createPipelineController({
            stores: {
                session: createSessionStore(root),
                checkpoints: createCheckpointStore(root),
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        await controller.start("/pipeline --complexa stabilize login flow");
        await controller.start("Yes");
        const planApprovalResult = await controller.start("Yes");
        const approvedSession = await createSessionStore(root).load();
        runBatch.mockResolvedValue({
            status: "completed",
            execution: {
                batchSize: 1,
            },
            changedFiles: ["src/controller/pipeline-controller.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: [approvedSession.executionProof?.approvedScenarios?.[0] ?? ""],
            },
        });
        const continueResult = await controller.start("/pipeline continue");
        expect(planApprovalResult.implementationPlan.status).toBe("APPROVED");
        expect(approvedSession.executionProof).toMatchObject({
            tddApproval: "REJECTED",
            redValidation: {
                status: "blocked",
            },
        });
        expect(approvedSession.executionProof?.approvedScenarios.length).toBeGreaterThan(0);
        expect(approvedSession.executionProof?.approvedScenarios.every((scenario) => scenario.startsWith("tests/") && scenario.endsWith(".test.ts"))).toBe(true);
        expect(runBatch).toHaveBeenCalled();
        expect(continueResult.status).toBe("completed");
        expect(continueResult.blockedBy).toBeUndefined();
        expect(continueResult.validation.status).toBe("passed");
    });
    it("uses the runtime-authoritative workspace root instead of process.cwd() for approval and RED proof", async () => {
        const repoRoot = process.cwd();
        const fakeCwd = mkdtempSync(join(tmpdir(), "pipeline-fake-cwd-"));
        const stateRoot = mkdtempSync(join(tmpdir(), "pipeline-controller-workspace-root-"));
        const runBatch = vi.fn();
        try {
            process.chdir(fakeCwd);
            const controller = createPipelineController({
                stores: {
                    session: createSessionStore(stateRoot),
                    checkpoints: createCheckpointStore(stateRoot),
                },
                executionController: createExecutorController({
                    runBatch,
                }),
                workspaceRoot: repoRoot,
            });
            await controller.start("/pipeline --complexa stabilize login flow");
            await controller.start("Yes");
            await controller.start("Yes");
            const approvedSession = await createSessionStore(stateRoot).load();
            runBatch.mockResolvedValue({
                execution: {
                    status: "implemented",
                },
                changedFiles: ["src/controller/pipeline-controller.ts"],
                review: {
                    status: "approved",
                },
                verificationEvidence: {
                    scenarios: [approvedSession.executionProof?.approvedScenarios?.[0] ?? ""],
                },
            });
            const continueResult = await controller.start("/pipeline continue");
            expect(approvedSession.executionProof?.approvedScenarios.length).toBeGreaterThan(0);
            expect(continueResult.status).toBe("completed");
            expect(continueResult.validation.status).toBe("passed");
        }
        finally {
            process.chdir(repoRoot);
        }
    });
    it.each([
        ["No", "REJECTED"],
        ["Adjust", "ADJUSTED"],
    ])("keeps continue blocked after approval is revoked with %s", async (response, status) => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-controller-revoke-"));
        const runBatch = vi.fn();
        const controller = createPipelineController({
            stores: {
                session: createSessionStore(root),
                checkpoints: createCheckpointStore(root),
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        await controller.start("/pipeline --complexa stabilize login flow");
        await controller.start("Yes");
        await controller.start("Yes");
        const planResult = await controller.start(response);
        const continueResult = await controller.start("/pipeline continue");
        expect(planResult.implementationPlan.status).toBe(status);
        expect(continueResult.status).toBe("blocked");
        expect(continueResult.blockedBy).toBe("TDD_APPROVAL");
        expect(runBatch).not.toHaveBeenCalled();
    });
    it.each([
        "phase-1.5-approval-required",
        "phase-1.5-reapproval-required",
    ])("blocks the real continue path when %s is still pending", async (pendingDecision) => {
        const runBatch = vi.fn();
        let savedSession;
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => ({
                        sessionId: "session-2",
                        currentPhase: "phase-1.5",
                        phase: "phase-1.5",
                        batchIndex: 0,
                        mode: "full",
                        variant: "bugfix-heavy",
                        confidenceScore: 1,
                        proposal: {
                            summary: "stabilize login flow",
                            variant: "bugfix-heavy",
                            awaitingUserConfirmation: true,
                            infoGateStatus: "passed",
                            designReviewStatus: "skipped",
                            planModeStatus: "required",
                            affectedFiles: ["src/controller/pipeline-controller.ts"],
                            batchSize: 1,
                            validationIntent: "standard",
                        },
                        approvalProof: {
                            kind: "controller-managed-transition",
                            from: "phase-1",
                            to: "phase-1.5",
                        },
                        pendingDecision,
                        unresolvedBlockers: [],
                        touchedFiles: ["src/controller/pipeline-controller.ts"],
                    }),
                    save: async (session) => {
                        savedSession = session;
                    },
                },
                checkpoints: {
                    list: async () => [],
                    save: async () => undefined,
                },
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        const result = await controller.start("/pipeline continue");
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("TDD_APPROVAL");
        expect(result.resumeBlocked).toBe(true);
        expect(result.rollbackGate).toBe("TDD_APPROVAL");
        expect(runBatch).not.toHaveBeenCalled();
    });
    it("rejects fabricated batch-runner verification evidence that is not controller-approved", async () => {
        const runBatch = vi.fn().mockResolvedValue({
            execution: {
                status: "implemented",
            },
            changedFiles: ["src/controller/pipeline-controller.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: ["tests/fabricated/missing-red-proof.test.ts"],
            },
        });
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => ({
                        sessionId: "session-3",
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
                            affectedFiles: ["src/controller/pipeline-controller.ts"],
                            batchSize: 1,
                            validationIntent: "standard",
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
                                reasons: ["fabricated"],
                            },
                            checkpointEvidence: [
                                {
                                    batchName: "batch-1",
                                    requiredCheckpoints: 1,
                                    verifiedCheckpoints: 1,
                                    evidence: ["fabricated pass"],
                                },
                            ],
                        },
                        unresolvedBlockers: [],
                        touchedFiles: ["src/controller/pipeline-controller.ts"],
                    }),
                    save: async () => undefined,
                },
                checkpoints: {
                    list: async () => [],
                    save: async () => undefined,
                },
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        const result = await controller.start("/pipeline continue");
        expect(runBatch).toHaveBeenCalledOnce();
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("CHECKPOINT_FAIL");
        expect(result.validation.status).toBe("failed");
        expect(result.validation.coverage).toBe(0);
    });
    it("re-derives approved scenarios on continue instead of trusting a forged persisted scenario list", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-controller-forged-proof-"));
        mkdirSync(join(root, "src"), { recursive: true });
        mkdirSync(join(root, "tests", "proof"), { recursive: true });
        writeFileSync(join(root, "src", "target.ts"), "export const target = 'target';\n", "utf8");
        writeFileSync(join(root, "src", "other.ts"), "export const other = 'other';\n", "utf8");
        writeFileSync(join(root, "tests", "proof", "other.test.ts"), "import { describe, expect, it } from 'vitest';\nimport { other } from '../../src/other.js';\n\ndescribe('other proof', () => {\n  it('covers a different file', () => {\n    expect(other).toBe('other');\n  });\n});\n", "utf8");
        const sessionStore = createSessionStore(root);
        await sessionStore.save({
            sessionId: "session-forged-proof",
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "--complexa",
            variant: "bugfix-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "stabilize target flow",
                variant: "bugfix-heavy",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "required",
                affectedFiles: ["src/target.ts"],
                batchSize: 1,
                validationIntent: "standard",
            },
            approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
            },
            executionProof: {
                approvedScenarios: ["tests/proof/other.test.ts"],
                tddApproval: "APPROVED",
                redValidation: {
                    status: "approved",
                    reasons: ["forged"],
                },
                checkpointEvidence: [],
                fixAttempts: [],
            },
            unresolvedBlockers: [],
            touchedFiles: ["src/target.ts"],
        });
        const runBatch = vi.fn();
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: sessionStore,
                checkpoints: createCheckpointStore(root),
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        const result = await controller.start("/pipeline continue");
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("TDD_APPROVAL");
        expect(runBatch).not.toHaveBeenCalled();
    });
    it("converts a plain checkpoint failure into a deterministic blocked controller outcome", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-controller-checkpoint-fail-"));
        mkdirSync(join(root, "src"), { recursive: true });
        mkdirSync(join(root, "tests", "proof"), { recursive: true });
        writeFileSync(join(root, "src", "target.ts"), "export const target = 'target';\n", "utf8");
        writeFileSync(join(root, "tests", "proof", "target.test.ts"), "import { describe, expect, it } from 'vitest';\nimport { target } from '../../src/target.js';\n\ndescribe('target proof', () => {\n  it('covers the target file', () => {\n    expect(target).toBe('target');\n  });\n});\n", "utf8");
        const sessionStore = createSessionStore(root);
        await sessionStore.save({
            sessionId: "session-checkpoint-fail",
            currentPhase: "phase-1.5",
            phase: "phase-1.5",
            batchIndex: 0,
            mode: "--complexa",
            variant: "bugfix-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "stabilize target flow",
                variant: "bugfix-heavy",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "required",
                affectedFiles: ["src/target.ts"],
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
            touchedFiles: ["src/target.ts"],
        });
        const runBatch = vi.fn().mockResolvedValue({
            execution: {
                status: "implemented",
            },
            changedFiles: ["src/target.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: [],
            },
        });
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: sessionStore,
                checkpoints: createCheckpointStore(root),
                gateLog: createGateLog(root),
                confidence: createConfidenceScoreStore(root),
            },
            executionController: createExecutorController({
                runBatch,
            }),
        });
        const firstResult = await controller.start("/pipeline continue");
        const secondResult = await controller.start("/pipeline continue");
        expect(firstResult.status).toBe("blocked");
        expect(firstResult.blockedBy).toBe("CHECKPOINT_FAIL");
        expect(firstResult.phase).toBe("phase-2");
        expect(firstResult.validation.status).toBe("failed");
        expect(secondResult.resumeBlocked).toBe(true);
        expect(secondResult.rollbackGate).toBe("CHECKPOINT_FAIL");
        expect(secondResult.rollbackRoute).toBe("revalidate");
    });
    it("does not leak checkpoint failure counts across separate executions", async () => {
        const runBatch = vi
            .fn()
            .mockResolvedValue({
            execution: {
                status: "implemented",
            },
            changedFiles: ["src/controller/pipeline-controller.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: ["tests/fabricated/missing-shared-proof.test.ts"],
            },
        });
        const controller = createExecutorController({
            runBatch,
        });
        const firstResult = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        const secondResult = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(firstResult.status).toBe("failed");
        expect(firstResult.validation?.status).toBe("failed");
        expect(secondResult.status).toBe("failed");
        expect(secondResult.validation?.status).toBe("failed");
    });
    it("routes changed files and hotfix mode through adversarial review and blocks on mandatory review failures", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            return {
                mode: "single-agent",
                role: "executor-implementer",
                output: {
                    implementation: "done",
                    modifiedFiles: ["src/auth/session.ts", "src/db/query-builder.ts"],
                    verificationEvidence: {
                        scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    },
                },
            };
        });
        const adversarialReview = vi.fn().mockResolvedValue({
            batch: "batch-1",
            status: "blocked",
            gate: "ADVERSARIAL_GATE_MANDATORY",
            required: true,
            checklists: ["auth", "injection"],
            findings: [
                {
                    severity: "important",
                    summary: "Session fix still allows injection into the lookup query.",
                },
            ],
        });
        const controller = createExecutorController({
            runRole,
            adversarialReview,
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/auth/session.ts", "src/db/query-builder.ts"],
            },
            mode: "--hotfix",
            proposal: {
                summary: "patch login session leak",
                affectedFiles: ["src/auth/session.ts", "src/db/query-builder.ts"],
                validationIntent: "reduced",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(adversarialReview).toHaveBeenCalledWith({
            batch: {
                name: "batch-1",
                files: ["src/auth/session.ts", "src/db/query-builder.ts"],
            },
            changedFiles: ["src/auth/session.ts", "src/db/query-builder.ts"],
            mode: "--hotfix",
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("ADVERSARIAL_BLOCK");
        expect(result.review).toEqual(expect.objectContaining({
            status: "blocked",
        }));
    });
    it("blocks injection-only hotfixes at the per-batch adversarial gate in the default runtime path", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            return {
                mode: "single-agent",
                role: "executor-implementer",
                output: {
                    implementation: "done",
                    modifiedFiles: ["src/db/query-builder.ts"],
                    verificationEvidence: {
                        scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    },
                },
            };
        });
        const controller = createExecutorController({
            runRole,
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/db/query-builder.ts"],
            },
            mode: "--hotfix",
            proposal: {
                summary: "patch unsafe query interpolation",
                affectedFiles: ["src/db/query-builder.ts"],
                validationIntent: "reduced",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("ADVERSARIAL_BLOCK");
        expect(result.review).toEqual(expect.objectContaining({
            status: "blocked",
            checklists: ["injection"],
            findings: expect.arrayContaining([
                expect.objectContaining({
                    severity: "important",
                }),
            ]),
        }));
    });
    it("runs the final adversarial team after batch review and blocks when the final team demands rework", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            return {
                mode: "single-agent",
                role: "executor-implementer",
                output: {
                    implementation: "done",
                    modifiedFiles: ["src/payments/checkout.ts"],
                    verificationEvidence: {
                        scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    },
                },
            };
        });
        const adversarialReview = vi.fn().mockResolvedValue({
            batch: "batch-1",
            status: "approved",
            gate: "ADVERSARIAL_GATE_MANDATORY",
            required: true,
            checklists: ["payment"],
            findings: [],
        });
        const finalAdversarialOrchestrator = vi.fn().mockResolvedValue({
            status: "rework",
            finalDecision: "blocked",
            findings: [
                {
                    id: "final-1",
                    severity: "important",
                    summary: "Cross-batch payment settlement invariant is broken.",
                    file: "src/payments/checkout.ts",
                },
            ],
            contradictions: [],
        });
        const controller = createExecutorController({
            runRole,
            adversarialReview,
            finalAdversarialOrchestrator,
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/payments/checkout.ts"],
            },
            proposal: {
                summary: "stabilize payment settlement",
                affectedFiles: ["src/payments/checkout.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(finalAdversarialOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
            scope: {
                files: ["src/payments/checkout.ts"],
            },
            changedDomains: ["payment"],
            reviews: [
                expect.objectContaining({
                    reviewer: "batch-1",
                    status: "approved",
                }),
            ],
        }));
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("FINAL_ADVERSARIAL_REWORK");
        expect(result.finalReview).toEqual(expect.objectContaining({
            status: "rework",
        }));
    });
    it("routes adversarial review and final review from the executor's actual modified files, not only the planned batch list", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            return {
                mode: "single-agent",
                role: "executor-implementer",
                output: {
                    implementation: "done",
                    modifiedFiles: ["src/auth/session.ts", "src/payments/checkout.ts"],
                    verificationEvidence: {
                        scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    },
                },
            };
        });
        const adversarialReview = vi.fn().mockResolvedValue({
            batch: "batch-1",
            status: "approved",
            gate: "ADVERSARIAL_GATE_MANDATORY",
            required: true,
            checklists: ["auth", "payment"],
            findings: [],
        });
        const finalAdversarialOrchestrator = vi.fn().mockResolvedValue({
            status: "rework",
            finalDecision: "blocked",
            findings: [
                {
                    id: "final-auth-payment",
                    severity: "important",
                    summary: "Final adversarial review saw sensitive real modifications.",
                    file: "src/payments/checkout.ts",
                },
            ],
            contradictions: [],
        });
        const controller = createExecutorController({
            runRole,
            adversarialReview,
            finalAdversarialOrchestrator,
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            proposal: {
                summary: "stabilize routing internals",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(adversarialReview).toHaveBeenCalledWith({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            changedFiles: ["src/auth/session.ts", "src/payments/checkout.ts"],
            mode: undefined,
        });
        expect(finalAdversarialOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
            scope: {
                files: ["src/auth/session.ts", "src/payments/checkout.ts"],
            },
            changedDomains: ["auth", "payment"],
        }));
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("FINAL_ADVERSARIAL_REWORK");
    });
    it("persists final adversarial rework as a controlled rollback before the next continue", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-final-rework-rollback-"));
        const runBatch = vi.fn().mockResolvedValue({
            execution: {
                status: "implemented",
            },
            changedFiles: ["src/payments/checkout.ts"],
            review: {
                status: "approved",
            },
            verificationEvidence: {
                scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
            },
        });
        const finalAdversarialOrchestrator = vi.fn().mockResolvedValue({
            status: "rework",
            finalDecision: "blocked",
            findings: [
                {
                    id: "final-payment-rework",
                    severity: "important",
                    summary: "Final adversarial review requires one targeted rework cycle.",
                    file: "src/payments/checkout.ts",
                },
            ],
            contradictions: [],
        });
        const controller = createPipelineController({
            stores: {
                session: createSessionStore(root),
                checkpoints: createCheckpointStore(root),
                gateLog: createGateLog(root),
                confidence: createConfidenceScoreStore(root),
            },
            executionController: createExecutorController({
                runBatch,
                finalAdversarialOrchestrator,
                reviewOrchestrator: {
                    reviewBatch: vi.fn().mockResolvedValue({
                        status: "approved",
                        findings: [],
                    }),
                },
            }),
        });
        await controller.start("/pipeline --complexa stabilize payment settlement");
        await controller.start("Yes");
        await controller.start("Yes");
        const firstResult = await controller.start("/pipeline continue");
        const secondResult = await controller.start("/pipeline continue");
        expect(firstResult.status).toBe("blocked");
        expect(firstResult.blockedBy).toBe("FINAL_ADVERSARIAL_REWORK");
        expect(firstResult.phase).toBe("phase-2");
        expect(secondResult.resumeBlocked).toBe(true);
        expect(secondResult.rollbackGate).toBe("FINAL_ADVERSARIAL_REWORK");
        expect(secondResult.rollbackRoute).toBe("replan");
    });
    it("blocks the default runtime defensively when the executor provides no authoritative changed-file evidence", async () => {
        const runRole = vi.fn().mockImplementation(async ({ role, input }) => {
            if (role === "pre-tester") {
                return createPreTesterDispatch();
            }
            if (role === "checkpoint-validator") {
                return createCheckpointValidatorDispatch(typeof input?.checkpointName === "string" ? input.checkpointName : "batch-1");
            }
            return {
                mode: "single-agent",
                role: "executor-implementer",
                output: {
                    implementation: "done",
                    verificationEvidence: {
                        scenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    },
                },
            };
        });
        const adversarialReview = vi.fn();
        const finalAdversarialOrchestrator = vi.fn();
        const controller = createExecutorController({
            runRole,
            adversarialReview,
            finalAdversarialOrchestrator,
            preTester: {
                deriveExecutionProof: () => ({
                    approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
                    tddApproval: "APPROVED",
                    redValidation: {
                        status: "approved",
                        reasons: [],
                    },
                    checkpointEvidence: [],
                    fixAttempts: [],
                }),
            },
        });
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            proposal: {
                summary: "stabilize routing internals",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(adversarialReview).not.toHaveBeenCalled();
        expect(finalAdversarialOrchestrator).not.toHaveBeenCalled();
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("ADVERSARIAL_SCOPE_MISSING");
        expect(result.review).toEqual(expect.objectContaining({
            status: "blocked",
            gate: "ADVERSARIAL_SCOPE_MISSING",
            findings: expect.arrayContaining([
                expect.objectContaining({
                    severity: "important",
                }),
            ]),
        }));
    });
    it("does not treat planned batch files as authoritative executor-changed files in the default runtime", async () => {
        const controller = createExecutorController();
        const result = await controller.executeApprovedWork({
            batch: {
                name: "batch-1",
                files: ["src/controller/pipeline-controller.ts"],
            },
            proposal: {
                summary: "stabilize routing internals",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                validationIntent: "standard",
                batchSize: 1,
            },
            approvedScenarios: ["tests/unit/controller/pipeline-controller.test.ts"],
        });
        expect(result.status).toBe("blocked");
        expect(result.blockedBy).toBe("ADVERSARIAL_SCOPE_MISSING");
        expect(result.review).toEqual(expect.objectContaining({
            status: "blocked",
            gate: "ADVERSARIAL_SCOPE_MISSING",
            files: [],
        }));
    });
});
