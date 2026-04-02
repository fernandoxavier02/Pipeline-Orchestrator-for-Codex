import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import { loadPipelineConfig } from "../../../src/config/load-pipeline-config.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
describe("pipeline config loading", () => {
    it("prefers .Codex/pipeline.local.md over package.json detection", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-local-"));
        try {
            await mkdir(join(root, ".Codex"), { recursive: true });
            await writeFile(join(root, ".Codex", "pipeline.local.md"), `---
doc_path: ".pipeline/docs"
spec_path: "specs/internal"
build_command: "pnpm build:prod"
test_command: "pnpm test:ci"
patterns_file: "docs/PATTERNS.internal.md"
---

# Local pipeline config
`, "utf8");
            await writeFile(join(root, "package.json"), JSON.stringify({
                name: "config-proof",
                scripts: {
                    build: "npm run ignored-build",
                    test: "npm run ignored-test",
                },
            }), "utf8");
            const config = loadPipelineConfig(root);
            expect(config.source).toBe("local-file");
            expect(config.buildCommand).toBe("pnpm build:prod");
            expect(config.testCommand).toBe("pnpm test:ci");
            expect(config.docPath).toBe(".pipeline/docs");
            expect(config.specPath).toBe("specs/internal");
            expect(config.patternsFile).toBe("docs/PATTERNS.internal.md");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("detects build and test commands from package.json scripts", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-package-"));
        try {
            await writeFile(join(root, "package.json"), JSON.stringify({
                name: "config-proof",
                scripts: {
                    build: "pnpm build",
                    test: "pnpm test",
                },
            }), "utf8");
            const config = loadPipelineConfig(root);
            expect(config.source).toBe("package-json");
            expect(config.buildCommand).toBe("pnpm build");
            expect(config.testCommand).toBe("pnpm test");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("falls back to common conventions when no explicit config exists", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-conventions-"));
        try {
            await mkdir(join(root, "docs"), { recursive: true });
            await mkdir(join(root, "specs"), { recursive: true });
            await writeFile(join(root, "PATTERNS.md"), "# Patterns\n", "utf8");
            const config = loadPipelineConfig(root);
            expect(config.source).toBe("conventions");
            expect(config.docPath).toBe("docs");
            expect(config.specPath).toBe("specs");
            expect(config.patternsFile).toBe("PATTERNS.md");
            expect(config.buildCommand).toBe("npm run build");
            expect(config.testCommand).toBe("npm test");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("wires the detected config into runtime closeout output", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-runtime-"));
        try {
            await mkdir(join(root, ".Codex"), { recursive: true });
            await writeFile(join(root, ".Codex", "pipeline.local.md"), `---
build_command: "pnpm build:prod"
test_command: "pnpm test:ci"
---
`, "utf8");
            await cp(join(process.cwd(), "prompts"), join(root, "prompts"), { recursive: true });
            await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
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
            await createSessionStore(runtime.stateDir).save({
                sessionId: "config-closeout-proof",
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
            });
            await createGateLog(runtime.stateDir).append({
                gate: "FINAL_ADVERSARIAL_GATE",
                hardness: "SOFT",
                phase: "phase-3",
                decision: "pass",
                decided_by: "controller",
                timestamp: "2026-04-02T12:30:00.000Z",
                detail: "Controller recorded final adversarial approval.",
                confidence_impact: 0,
            });
            const closeout = await runtime.closeout.finalize({
                reviews: [{ status: "approved" }],
                batches: [{ name: "batch-1" }],
                verificationEvidence: [
                    { kind: "build", passed: true },
                    { kind: "tests", passed: true },
                    { kind: "final-review", passed: true, label: "final adversarial review" },
                ],
                confirmed: true,
            });
            expect(runtime.config.buildCommand).toBe("pnpm build:prod");
            expect(runtime.config.testCommand).toBe("pnpm test:ci");
            expect(closeout.text).toContain("pnpm build:prod");
            expect(closeout.text).toContain("pnpm test:ci");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("degrades to conventions when optional local config is malformed", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-malformed-local-"));
        try {
            await mkdir(join(root, ".Codex"), { recursive: true });
            await mkdir(join(root, "docs"), { recursive: true });
            await mkdir(join(root, "specs"), { recursive: true });
            await writeFile(join(root, "PATTERNS.md"), "# Patterns\n", "utf8");
            await writeFile(join(root, ".Codex", "pipeline.local.md"), `---
doc_path: "unterminated
`, "utf8");
            const config = loadPipelineConfig(root);
            expect(config.source).toBe("conventions");
            expect(config.docPath).toBe("docs");
            expect(config.specPath).toBe("specs");
            expect(config.patternsFile).toBe("PATTERNS.md");
            expect(config.buildCommand).toBe("npm run build");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("degrades to defaults when optional package.json is malformed", async () => {
        const root = await mkdtemp(join(tmpdir(), "pipeline-config-malformed-package-"));
        try {
            await writeFile(join(root, "package.json"), "{ not-valid-json ", "utf8");
            const config = loadPipelineConfig(root);
            expect(config.source).toBe("defaults");
            expect(config.buildCommand).toBe("npm run build");
            expect(config.testCommand).toBe("npm test");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
