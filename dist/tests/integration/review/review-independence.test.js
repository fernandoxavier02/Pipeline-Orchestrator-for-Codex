import { describe, expect, it, vi } from "vitest";
describe("review independence", () => {
    it("dispatches batch review from fresh context using only batch metadata and file lists", async () => {
        const { createReviewOrchestrator } = await import("../../../src/review/review-orchestrator.js");
        const runRole = vi.fn().mockResolvedValue({
            mode: "parallel-emulation",
            role: "review-orchestrator",
            output: {
                findings: [],
            },
        });
        const orchestrator = createReviewOrchestrator({ runRole });
        await orchestrator.reviewBatch({
            batch: {
                name: "Batch 4",
                files: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
            },
            implementationSummary: "Fixed the auth leak by reworking session handling.",
            changedDomains: ["auth"],
        });
        expect(runRole).toHaveBeenCalledTimes(1);
        const request = runRole.mock.calls[0]?.[0];
        expect(request).toEqual(expect.objectContaining({
            mode: "parallel-emulation",
            role: expect.stringContaining("review"),
            filesInScope: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
            authorityLevel: "controller",
        }));
        expect(request.team).toEqual([
            expect.objectContaining({
                role: "batch-reviewer",
                filesInScope: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
                authorityLevel: "reviewer",
            }),
            expect.objectContaining({
                role: "executor-spec-reviewer",
                filesInScope: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
                authorityLevel: "reviewer",
            }),
            expect.objectContaining({
                role: "quality-reviewer",
                filesInScope: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
                authorityLevel: "reviewer",
            }),
        ]);
        expect(request.input).not.toHaveProperty("implementationSummary");
        expect(request.prompt).not.toContain("session handling");
    });
    it("requires real agent dispatch for operational batch review when configured", async () => {
        const { createReviewOrchestrator } = await import("../../../src/review/review-orchestrator.js");
        const runRole = vi.fn().mockResolvedValue({
            mode: "real-agent",
            role: "review-orchestrator",
            output: {
                findings: [],
            },
        });
        const orchestrator = createReviewOrchestrator({ runRole, requireRealAgent: true });
        await orchestrator.reviewBatch({
            batch: {
                name: "Batch operational-review",
                files: ["src/index.ts"],
            },
        });
        expect(runRole.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            requireRealAgent: true,
        }));
    });
    it("returns parsed reviewer outputs so downstream execution can consume direct review decisions", async () => {
        const { createReviewOrchestrator } = await import("../../../src/review/review-orchestrator.js");
        const runRole = vi.fn().mockResolvedValue({
            mode: "parallel-emulation",
            role: "review-orchestrator",
            output: {
                status: "blocked",
                findings: [],
                agents: [
                    {
                        role: "executor-spec-reviewer",
                        output: {
                            status: "blocked",
                            findings: [
                                {
                                    severity: "important",
                                    summary: "Spec reviewer found missing rollback coverage.",
                                    file: "src/controller/pipeline-controller.ts",
                                },
                            ],
                        },
                    },
                    {
                        role: "quality-reviewer",
                        output: {
                            status: "blocked",
                            findings: [
                                {
                                    severity: "minor",
                                    summary: "Quality reviewer found missing continue regression proof.",
                                    file: "src/controller/pipeline-controller.ts",
                                },
                            ],
                        },
                    },
                ],
            },
        });
        const orchestrator = createReviewOrchestrator({ runRole });
        const result = await orchestrator.reviewBatch({
            batch: {
                name: "Batch direct-review-inputs",
                files: ["src/controller/pipeline-controller.ts"],
            },
        });
        expect(result.reviews).toEqual([
            expect.objectContaining({
                reviewer: "executor-spec-reviewer",
                status: "blocked",
                findings: expect.arrayContaining([
                    expect.objectContaining({
                        summary: "Spec reviewer found missing rollback coverage.",
                    }),
                ]),
            }),
            expect.objectContaining({
                reviewer: "quality-reviewer",
                status: "blocked",
                findings: expect.arrayContaining([
                    expect.objectContaining({
                        summary: "Quality reviewer found missing continue regression proof.",
                    }),
                ]),
            }),
        ]);
    });
    it.each([
        {
            label: "auth",
            file: "src/auth/session.ts",
            checklist: "auth",
        },
        {
            label: "crypto",
            file: "src/security/crypto.ts",
            checklist: "crypto",
        },
        {
            label: "data-model",
            file: "src/domain/user-model.ts",
            checklist: "data-model",
        },
        {
            label: "payment",
            file: "src/payments/checkout.ts",
            checklist: "payment",
        },
    ])("escalates mandatory adversarial review for $label changes", async ({ file, checklist }) => {
        const { runAdversarialReview } = await import("../../../src/review/adversarial-review.js");
        const result = await runAdversarialReview({
            batch: {
                name: "Sensitive batch",
                files: [file],
            },
            findings: [],
            changedFiles: [file],
        });
        expect(result.required).toBe(true);
        expect(result.gate).toBe("ADVERSARIAL_GATE_MANDATORY");
        expect(result.decision).toBe("escalate");
        expect(result.checklists).toEqual(expect.arrayContaining([checklist]));
    });
    it("combines final adversarial findings across security, architecture, and quality reviewers and records contradictions", async () => {
        const { runFinalAdversarialOrchestrator } = await import("../../../src/review/final-adversarial-orchestrator.js");
        const result = await runFinalAdversarialOrchestrator({
            scope: {
                files: ["src/payments/checkout.ts", "src/review/adversarial-review.ts"],
            },
            reviews: [
                {
                    reviewer: "security",
                    status: "approved",
                    findings: [],
                    notes: ["No security blockers found."],
                },
                {
                    reviewer: "architecture",
                    status: "blocked",
                    findings: [
                        {
                            id: "arch-1",
                            severity: "important",
                            summary: "Payment orchestration bypasses the settlement invariant.",
                            file: "src/payments/checkout.ts",
                        },
                    ],
                    notes: ["Cross-batch invariant broken."],
                },
                {
                    reviewer: "quality",
                    status: "approved",
                    findings: [
                        {
                            id: "quality-1",
                            severity: "minor",
                            summary: "Missing regression coverage for settlement retries.",
                            file: "src/payments/checkout.ts",
                        },
                    ],
                    notes: ["Quality review is otherwise clear."],
                },
            ],
        });
        expect(result.status).toBe("rework");
        expect(result.finalDecision).toBe("blocked");
        expect(result.findings).toHaveLength(2);
        expect(result.findings.map((finding) => finding.id)).toEqual(["arch-1", "quality-1"]);
        expect(result.contradictions).toEqual([
            expect.objectContaining({
                reviewers: expect.arrayContaining(["security", "architecture"]),
            }),
        ]);
    });
    it("dispatches an independent final adversarial team with distinct security, architecture, and quality reviewers", async () => {
        const { createFinalAdversarialOrchestrator } = await import("../../../src/review/final-adversarial-orchestrator.js");
        const runRole = vi
            .fn()
            .mockResolvedValueOnce({
            mode: "parallel-emulation",
            role: "final-adversarial-orchestrator",
            output: {
                agents: [
                    { role: "security-reviewer", output: { findings: [] } },
                    { role: "architecture-reviewer", output: { findings: [] } },
                    { role: "quality-reviewer", output: { findings: [] } },
                ],
                findings: [
                    {
                        id: "arch-1",
                        severity: "important",
                        summary: "Cross-batch invariant is unguarded.",
                        file: "src/payments/checkout.ts",
                        reviewer: "architecture-reviewer",
                    },
                ],
                status: "blocked",
            },
        });
        const orchestrator = createFinalAdversarialOrchestrator({ runRole });
        const result = await orchestrator.reviewFinal({
            scope: {
                files: ["src/payments/checkout.ts"],
            },
            changedDomains: ["payment"],
        });
        expect(runRole).toHaveBeenCalledTimes(1);
        expect(runRole.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            mode: "parallel-emulation",
            role: "final-adversarial-orchestrator",
            authorityLevel: "controller",
            filesInScope: ["src/payments/checkout.ts"],
            team: [
                expect.objectContaining({ role: "security-reviewer" }),
                expect.objectContaining({ role: "architecture-reviewer" }),
                expect.objectContaining({ role: "quality-reviewer" }),
            ],
        }));
        expect(result.finalDecision).toBe("blocked");
        expect(result.reviews.map((review) => review.reviewer)).toEqual([
            "security",
            "architecture",
            "quality",
        ]);
    });
    it("requires real agent dispatch for operational final adversarial review when configured", async () => {
        const { createFinalAdversarialOrchestrator } = await import("../../../src/review/final-adversarial-orchestrator.js");
        const runRole = vi.fn().mockResolvedValueOnce({
            mode: "real-agent",
            role: "final-adversarial-orchestrator",
            output: {
                agents: [
                    { role: "security-reviewer", output: { findings: [] } },
                    { role: "architecture-reviewer", output: { findings: [] } },
                    { role: "quality-reviewer", output: { findings: [] } },
                ],
            },
        });
        const orchestrator = createFinalAdversarialOrchestrator({ runRole, requireRealAgent: true });
        await orchestrator.reviewFinal({
            scope: {
                files: ["src/index.ts"],
            },
        });
        expect(runRole.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            requireRealAgent: true,
        }));
    });
});
