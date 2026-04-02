import { describe, expect, it, vi } from "vitest";

describe("review independence", () => {
  it("dispatches batch review from fresh context using only batch metadata and file lists", async () => {
    const { createReviewOrchestrator } = await import("../../../src/review/review-orchestrator.js");
    const runRole = vi.fn().mockResolvedValue({
      mode: "single-agent",
      role: "batch-reviewer",
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
    expect(request).toEqual(
      expect.objectContaining({
        mode: "single-agent",
        role: expect.stringContaining("review"),
      }),
    );
    expect(request.prompt).toContain("fresh context");
    expect(request.prompt).toContain("review only");
    expect(request.input).toEqual({
      batch: {
        name: "Batch 4",
        files: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
      },
      files: ["src/auth/session.ts", "src/review/adversarial-review.ts"],
      changedDomains: ["auth"],
      reviewOnly: true,
    });
    expect(request.input).not.toHaveProperty("implementationSummary");
    expect(request.prompt).not.toContain("session handling");
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
    } as any);

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
    expect(result.findings.map((finding: { id: string }) => finding.id)).toEqual(["arch-1", "quality-1"]);
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
        mode: "single-agent",
        role: "security-reviewer",
        output: {
          findings: [],
        },
      })
      .mockResolvedValueOnce({
        mode: "single-agent",
        role: "architecture-reviewer",
        output: {
          findings: [
            {
              id: "arch-1",
              severity: "important",
              summary: "Cross-batch invariant is unguarded.",
              file: "src/payments/checkout.ts",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        mode: "single-agent",
        role: "quality-reviewer",
        output: {
          findings: [],
        },
      });
    const orchestrator = createFinalAdversarialOrchestrator({ runRole });

    const result = await orchestrator.reviewFinal({
      scope: {
        files: ["src/payments/checkout.ts"],
      },
      changedDomains: ["payment"],
    });

    expect(runRole).toHaveBeenCalledTimes(3);
    expect(runRole.mock.calls.map((call) => call[0].role)).toEqual([
      "security-reviewer",
      "architecture-reviewer",
      "quality-reviewer",
    ]);
    expect(runRole.mock.calls.every((call) => !("implementationSummary" in call[0].input))).toBe(true);
    expect(result.finalDecision).toBe("blocked");
    expect(result.reviews.map((review: { reviewer: string }) => review.reviewer)).toEqual([
      "security",
      "architecture",
      "quality",
    ]);
  });
});
