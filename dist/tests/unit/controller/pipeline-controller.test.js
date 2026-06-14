import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        expect(result.proposal.workflowSelection).toMatchObject({
            status: "awaiting-user-confirmation",
            selectedWorkflow: {
                type: "Bug Fix",
                variant: expect.stringMatching(/bugfix/),
            },
        });
        expect(result.proposal.workflowSelection.question).toContain("workflow");
        expect(result.proposal.workflowSelection.options.map((option) => option.command))
            .toEqual(expect.arrayContaining(["yes", "adjust", "audit", "bugfix", "feature", "ux", "spec"]));
        expect(result.gates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "COMPLEXITY_GATE",
                status: "passed",
                hardness: "SOFT",
            }),
            expect.objectContaining({
                gate: "STEP_1_7_ROUTING",
                status: "passed",
                hardness: "HARD",
            }),
        ]));
    });
    it("RED: explicit pipeline bootstrap creates shared lock, session, sentinel, and gate state before proposal", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "pipeline-controller-bootstrap-"));
        const runtime = createPipelineRuntime({
            cwd,
            codexHome: cwd,
            strictAgents: true,
            agentRuntime: {
                capabilities: {
                    spawnAgent: true,
                    waitAgent: true,
                    collectArtifacts: true,
                    recordGates: true,
                    recordCheckpoints: true,
                    structuredFinalState: true,
                },
                async spawnAgent(request) {
                    return {
                        mode: "single-agent",
                        role: request.role,
                        output: { status: "approved", dispatchMode: "real-agent" },
                    };
                },
                async waitAgent(dispatch) {
                    return dispatch;
                },
                async collectArtifacts(dispatches) {
                    return dispatches.map((dispatch) => dispatch.output);
                },
            },
        });
        await runtime.controller.start("/pipeline-orchestrator-for-codex:pipeline fix explicit bootstrap");
        const stateDir = join(cwd, ".codex", "pipeline");
        expect(existsSync(join(stateDir, "session-lock.json"))).toBe(true);
        expect(existsSync(join(stateDir, "session.json"))).toBe(true);
        expect(existsSync(join(stateDir, "sentinel-state.json"))).toBe(true);
        expect(existsSync(join(stateDir, "gate-decisions.jsonl"))).toBe(true);
        const lock = JSON.parse(readFileSync(join(stateDir, "session-lock.json"), "utf8"));
        const session = JSON.parse(readFileSync(join(stateDir, "session.json"), "utf8"));
        const sentinel = JSON.parse(readFileSync(join(stateDir, "sentinel-state.json"), "utf8"));
        expect(session.sessionId).toBe(lock.session_id);
        expect(sentinel.session_id).toBe(lock.session_id);
        expect(session.runtime_mode).toBe("real-agent");
    });
    it("RED: explicit pipeline with strictAgents=false is harness and cannot pass capability gate", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "pipeline-controller-harness-"));
        const runtime = createPipelineRuntime({
            cwd,
            codexHome: cwd,
            strictAgents: false,
            agentRuntime: {
                capabilities: {
                    spawnAgent: true,
                    waitAgent: true,
                    collectArtifacts: true,
                    recordGates: true,
                    recordCheckpoints: true,
                    structuredFinalState: true,
                },
                async spawnAgent(request) {
                    return {
                        mode: "single-agent",
                        role: request.role,
                        output: { status: "approved", dispatchMode: "real-agent" },
                    };
                },
                async waitAgent(dispatch) {
                    return dispatch;
                },
                async collectArtifacts(dispatches) {
                    return dispatches.map((dispatch) => dispatch.output);
                },
            },
        });
        const result = await runtime.controller.start("/pipeline-orchestrator-for-codex:pipeline fix harness false pass");
        expect(result).toMatchObject({
            status: "BLOCKED",
            pipeline_valid: false,
            runtime_mode: "harness",
        });
        expect(result.gates).toEqual([
            expect.objectContaining({
                gate: "BYPASS_MODE_ACTIVE",
                status: "BLOCKED",
            }),
        ]);
    });
    it("records no-plan bypass semantics instead of silently skipping planning", async () => {
        const mediaResult = await runtime.controller.start("/pipeline --no-plan add small feature flag copy");
        expect(mediaResult.planModeStatus).toBe("skipped");
        expect(mediaResult.proposal.planModeBypass).toMatchObject({
            attempted: true,
            honored: true,
        });
        const complexResult = await runtime.controller.start("/pipeline --no-plan implement complex workflow boundary");
        expect(complexResult.planModeStatus).toBe("required");
        expect(complexResult.proposal.planModeBypass).toMatchObject({
            attempted: true,
            honored: false,
        });
        expect(complexResult.proposal.planModeRequest).toMatchObject({
            kind: "PLAN_MODE_REQUEST",
        });
    });
    it("records COMPLEXITY_GATE as partial when a mode override downgrades the classifier", async () => {
        const appendedGateEntries = [];
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => undefined,
                    save: async () => undefined,
                },
                checkpoints: {
                    list: async () => [],
                },
                gateLog: {
                    append: async (entry) => {
                        appendedGateEntries.push(entry);
                    },
                    list: async () => appendedGateEntries,
                },
                confidence: {
                    save: async () => undefined,
                },
            },
        });
        const result = await controller.start("/pipeline --simples implement complex workflow boundary");
        expect(result.gates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "COMPLEXITY_GATE",
                status: "partial",
                hardness: "SOFT",
            }),
        ]));
        expect(appendedGateEntries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "COMPLEXITY_GATE",
                decision: "partial",
                hardness: "SOFT",
                phase: "phase-0",
            }),
        ]));
    });
    it("records STEP_1_7_ROUTING when the controller selects an initial route", async () => {
        const appendedGateEntries = [];
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => undefined,
                    save: async () => undefined,
                },
                checkpoints: {
                    list: async () => [],
                },
                gateLog: {
                    append: async (entry) => {
                        appendedGateEntries.push(entry);
                    },
                    list: async () => appendedGateEntries,
                },
                confidence: {
                    save: async () => undefined,
                },
            },
        });
        const result = await controller.start("/pipeline --no-plan add small feature flag copy");
        expect(result.gates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "STEP_1_7_ROUTING",
                status: "passed",
                hardness: "HARD",
                reason: expect.stringContaining("no-plan-bypass-evaluation"),
            }),
        ]));
        expect(appendedGateEntries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "STEP_1_7_ROUTING",
                decision: "pass",
                hardness: "HARD",
                phase: "phase-1",
            }),
        ]));
    });
    it("lets the user switch the selected workflow before approving execution", async () => {
        let sessionState;
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => sessionState,
                    save: async (nextSession) => {
                        sessionState = nextSession;
                    },
                },
                checkpoints: {
                    list: async () => [],
                },
            },
        });
        await controller.start("fix login redirect loop");
        const result = await controller.start("audit");
        expect(result.phase).toBe("phase-1");
        expect(result.workflowSwitch).toMatchObject({
            status: "UPDATED",
            from: "Bug Fix",
            to: "Audit",
        });
        expect(result.proposal.workflowSelection.selectedWorkflow).toMatchObject({
            type: "Audit",
            variant: expect.stringMatching(/audit/),
        });
        expect((sessionState?.proposal).workflowSelection.selectedWorkflow.type).toBe("Audit");
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
                            planModeRequest: {
                                kind: "PLAN_MODE_REQUEST",
                                protocol_version: 1,
                                plan_id: "plan-audit-heavy",
                                research_scope: "Plan harden audit trail before execution.",
                                expected_deliverables: ["Batches", "Tests"],
                            },
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
        expect(result.planModeRequest).toMatchObject({
            kind: "PLAN_MODE_REQUEST",
            plan_id: "plan-audit-heavy",
        });
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
    it("records STEP_1_7_RECURSION_GUARD before rejecting recursive continue during proposal confirmation", async () => {
        const appendedGateEntries = [];
        const controller = createPipelineController({
            stores: {
                session: {
                    load: async () => ({
                        currentPhase: "phase-1",
                        confidenceScore: 0.9,
                    }),
                },
                checkpoints: {
                    list: async () => [],
                },
                gateLog: {
                    append: async (entry) => {
                        appendedGateEntries.push(entry);
                    },
                    list: async () => appendedGateEntries,
                },
                confidence: {
                    save: async () => undefined,
                },
            },
        });
        await expect(controller.start("/pipeline continue")).rejects.toThrow("Cannot continue while proposal confirmation is pending");
        expect(appendedGateEntries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                gate: "STEP_1_7_RECURSION_GUARD",
                decision: "block",
                hardness: "CIRCUIT_BREAKER",
                phase: "phase-1",
            }),
        ]));
    });
    it("persists a final adversarial rework rollback route during continue", { timeout: 10000 }, async () => {
        let sessionState = {
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
                        sessionState = nextSession;
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
            },
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
        let sessionState = {
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
                        sessionState = nextSession;
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
            },
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
        await expect(controller.start("/pipeline continue")).rejects.toThrow('Unknown continue pending decision "unknown"');
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
        await expect(controller.start("/pipeline continue")).rejects.toThrow("Unable to resolve blocked continue rollback metadata");
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
        await expect(controller.start("/pipeline continue")).rejects.toThrow("Unable to resolve blocked continue rollback metadata");
    });
});
