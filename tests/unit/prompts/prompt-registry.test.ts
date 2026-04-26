import { describe, expect, it } from "vitest";
import { createPromptRegistry } from "../../../src/prompts/prompt-registry.js";

describe("prompt registry", () => {
  it("loads the information gate prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/information-gate");
    expect(prompt).toContain("Ask one question at a time");
  });

  it("loads the dedicated security reviewer prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/security-reviewer");
    expect(prompt).toContain("Prioritize auth, crypto, payment, and injection risk.");
  });

  it("loads the review orchestrator prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/review-orchestrator");
    expect(prompt).toContain("Coordinate the independent per-batch review team.");
  });

  it("loads the checkpoint validator prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/checkpoint-validator");
    expect(prompt).toContain("Require evidence before any per-batch pass claim.");
  });

  it("loads the sentinel prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/sentinel");
    expect(prompt).toContain("Protect the expected pipeline sequence.");
  });

  it("loads the design interrogator prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/design-interrogator");
    expect(prompt).toContain("Resolve design trade-offs before implementation.");
  });

  it("loads the plan architect prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/plan-architect");
    expect(prompt).toContain("Produce a read-only implementation plan.");
  });

  it("loads the pre-tester prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/pre-tester");
    expect(prompt).toContain("Validate that approved scenarios are real runnable tests before implementation begins.");
  });

  it("loads the quality gate router prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/quality-gate-router");
    expect(prompt).toContain("Plan the approved Phase 2 task set into proportional execution batches.");
  });

  it("loads the sanity checker prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/sanity-checker");
    expect(prompt).toContain("Run final proportional verification before the final decision.");
  });

  it("loads the final validator prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/final-validator");
    expect(prompt).toContain("Issue the final GO, CONDITIONAL, or NO-GO decision.");
  });

  it("loads the executor fix prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("executor/executor-fix");
    expect(prompt).toContain("Apply findings from fresh context within the original write scope.");
  });

  it("loads the executor spec reviewer prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("executor/executor-spec-reviewer");
    expect(prompt).toContain("Check requirement compliance directly from the changed files.");
  });

  it("loads the adversarial-quality-reviewer prompt and validates the required output blocks (B9)", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("quality/adversarial-quality-reviewer");
    expect(prompt).toContain("Adversarial Quality Reviewer");
    expect(prompt).toContain("Required output block:");
    for (const block of ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"]) {
      expect(prompt).toMatch(new RegExp(`(^|\\n)-\\s+${block}\\s*(\\n|$)`));
    }
  });

  it("loads the pipeline-controller prompt and validates the required output blocks (B8)", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("controller/pipeline-controller");
    expect(prompt).toContain("pipeline-orchestrator-for-codex:core:pipeline-controller");
    expect(prompt).toContain("Required output block:");
    for (const block of ["MODE", "TYPE", "COMPLEXITY", "VARIANT", "PROPOSAL"]) {
      expect(prompt).toMatch(new RegExp(`(^|\\n)-\\s+${block}\\s*(\\n|$)`));
    }
    expect(prompt).toContain("exec-window");
    expect(prompt).toContain("dispatch-guard");
    expect(prompt).toContain("sentinel-state.json");
  });
});
