import { execFileSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createPipelineRuntime } from "../../../src/index.js";
import { createSessionStore } from "../../../src/state/session-store.js";
function git(cwd, args) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
    });
}
describe("review-only whole diff", () => {
    it("scans the current uncommitted git diff and does not auto-fix files", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-review-whole-diff-"));
        await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
        await mkdir(join(root, "src", "auth"), { recursive: true });
        await writeFile(join(root, "src", "auth", "session.ts"), "export const sessionBoundary = 'before';\n", "utf8");
        git(root, ["init"]);
        git(root, ["config", "user.name", "Codex Tester"]);
        git(root, ["config", "user.email", "codex@example.com"]);
        git(root, ["add", "."]);
        git(root, ["commit", "-m", "initial"]);
        await writeFile(join(root, "src", "auth", "session.ts"), "export const sessionBoundary = 'after';\n", "utf8");
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        const result = await runtime.controller.start("/pipeline review-only inspect the current diff");
        expect(result.mode).toBe("review-only");
        expect(result.implementationSkipped).toBe(true);
        expect(result.proposal.affectedFiles).toEqual(["src/auth/session.ts"]);
        const statusAfterReview = git(root, ["status", "--short"]);
        expect(statusAfterReview).toContain(" M src/auth/session.ts");
        expect(existsSync(join(runtime.stateDir, "session.json"))).toBe(false);
        await expect(createSessionStore(runtime.stateDir).load()).rejects.toThrow();
    });
    it("executes real review orchestration against the whole diff without entering implementation", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-review-whole-diff-flow-"));
        await mkdir(join(root, "src", "payments"), { recursive: true });
        await writeFile(join(root, "src", "payments", "checkout.ts"), "export const checkoutBoundary = 'before';\n", "utf8");
        git(root, ["init"]);
        git(root, ["config", "user.name", "Codex Tester"]);
        git(root, ["config", "user.email", "codex@example.com"]);
        git(root, ["add", "."]);
        git(root, ["commit", "-m", "initial"]);
        await writeFile(join(root, "src", "payments", "checkout.ts"), "export const checkoutBoundary = 'after';\n", "utf8");
        const reviewOrchestrator = {
            reviewBatch: vi.fn().mockResolvedValue({
                batch: "whole-diff-review",
                files: ["src/payments/checkout.ts"],
                changedDomains: ["payment"],
                findings: [
                    {
                        severity: "important",
                        summary: "Settlement invariants are not protected.",
                    },
                ],
                status: "blocked",
            }),
        };
        const stateRoot = join(root, ".codex", "pipeline");
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: createSessionStore(stateRoot),
            },
            reviewOrchestrator,
        });
        const result = await controller.start("/pipeline review-only inspect the current diff");
        expect(reviewOrchestrator.reviewBatch).toHaveBeenCalledWith({
            batch: {
                name: "whole-diff-review",
                files: ["src/payments/checkout.ts"],
            },
            changedFiles: ["src/payments/checkout.ts"],
            changedDomains: ["payment"],
        });
        expect(result.mode).toBe("review-only");
        expect(result.implementationSkipped).toBe(true);
        expect(result.review.status).toBe("blocked");
        expect(result.review.findings).toHaveLength(1);
        await expect(createSessionStore(stateRoot).load()).rejects.toThrow();
    });
    it("blocks sensitive default review-only runs when no independent review evidence exists", { timeout: 10000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-review-default-block-"));
        await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
        await mkdir(join(root, "src", "auth"), { recursive: true });
        await writeFile(join(root, "src", "auth", "session.ts"), "export const sensitiveBoundary = 'before';\n", "utf8");
        git(root, ["init"]);
        git(root, ["config", "user.name", "Codex Tester"]);
        git(root, ["config", "user.email", "codex@example.com"]);
        git(root, ["add", "."]);
        git(root, ["commit", "-m", "initial"]);
        await writeFile(join(root, "src", "auth", "session.ts"), "export const sensitiveBoundary = 'after';\n", "utf8");
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        const result = await runtime.controller.start("/pipeline review-only inspect the current diff");
        expect(result.review).toEqual(expect.objectContaining({
            findings: expect.arrayContaining([
                expect.objectContaining({
                    severity: "important",
                }),
            ]),
        }));
    });
    it("does not fabricate a whole-diff review scope when git discovery returns no real changed files", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-review-no-real-diff-"));
        const reviewOrchestrator = {
            reviewBatch: vi.fn(),
        };
        const controller = createPipelineController({
            workspaceRoot: root,
            stores: {
                session: createSessionStore(join(root, ".codex", "pipeline")),
            },
            reviewOrchestrator,
        });
        const result = await controller.start("/pipeline review-only inspect the current diff");
        expect(reviewOrchestrator.reviewBatch).not.toHaveBeenCalled();
        expect(result.mode).toBe("review-only");
        expect(result.implementationSkipped).toBe(true);
        expect(result.proposal.affectedFiles).toEqual([]);
        expect(result.review).toEqual(expect.objectContaining({
            status: "blocked",
            findings: expect.arrayContaining([
                expect.objectContaining({
                    severity: "important",
                    summary: expect.stringContaining("No real uncommitted git diff"),
                }),
            ]),
        }));
    });
});
