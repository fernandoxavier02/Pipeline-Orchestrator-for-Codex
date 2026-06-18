import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_NEXT_STEPS,
  renderNextStepBlock,
  resolveNextStep,
} from "../../../src/workflow/next-step.js";

const skillsRoot = join(process.cwd(), "skills");

describe("workflow next-step contract", () => {
  it("covers every public skill workflow with an explicit next-step rule", () => {
    const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(Object.keys(WORKFLOW_NEXT_STEPS).sort()).toEqual(skillNames);
  });

  it("keeps the spec lifecycle intelligible from brainstorm through execution", () => {
    expect(resolveNextStep({ workflow: "spec", status: "passed", runId: "001-checkout" })).toMatchObject({
      mode: "suggest",
      nextWorkflow: "spec-init",
      command: "/pipeline-orchestrator-for-codex:spec-init 001-checkout",
    });
    expect(resolveNextStep({ workflow: "brainstorm", status: "passed", runId: "001-checkout" })).toMatchObject({
      mode: "suggest",
      nextWorkflow: "spec-init",
      command: "/pipeline-orchestrator-for-codex:spec-init 001-checkout",
    });
    expect(resolveNextStep({ workflow: "spec-init", status: "passed", runId: "001-checkout" })).toMatchObject({
      nextWorkflow: "spec-requirements",
      command: "/pipeline-orchestrator-for-codex:spec-requirements 001-checkout",
    });
    expect(resolveNextStep({ workflow: "spec-requirements", status: "passed", runId: "001-checkout" })).toMatchObject({
      nextWorkflow: "spec-design",
      command: "/pipeline-orchestrator-for-codex:spec-design 001-checkout",
    });
    expect(resolveNextStep({ workflow: "spec-design", status: "passed", runId: "001-checkout" })).toMatchObject({
      nextWorkflow: "validate-design",
      command: "/pipeline-orchestrator-for-codex:validate-design 001-checkout",
    });
    expect(resolveNextStep({ workflow: "validate-design", status: "passed", runId: "001-checkout" })).toMatchObject({
      nextWorkflow: "spec-tasks",
      command: "/pipeline-orchestrator-for-codex:spec-tasks 001-checkout",
    });
    expect(resolveNextStep({
      workflow: "spec-tasks",
      status: "passed",
      runId: "001-checkout",
      complexity: "COMPLEXA",
    })).toMatchObject({
      nextWorkflow: "spec-heavy",
      command: "/pipeline-orchestrator-for-codex:spec-heavy 001-checkout",
    });
  });

  it("routes simple implementation families to review and final verification", () => {
    expect(resolveNextStep({ workflow: "feature-light", status: "passed" })).toMatchObject({
      nextWorkflow: "review",
      command: "/pipeline-orchestrator-for-codex:review feature-light",
    });
    expect(resolveNextStep({ workflow: "bugfix-heavy", status: "passed" })).toMatchObject({
      nextWorkflow: "review",
      command: "/pipeline-orchestrator-for-codex:review bugfix-heavy",
    });
    expect(resolveNextStep({ workflow: "review", status: "passed" })).toMatchObject({
      nextWorkflow: "verify-completion",
      command: "/pipeline-orchestrator-for-codex:verify-completion review",
    });
    expect(resolveNextStep({ workflow: "verify-completion", status: "passed" })).toMatchObject({
      mode: "stop",
      nextWorkflow: null,
      command: null,
    });
  });

  it("blocks the next step when the current gate has not passed", () => {
    expect(resolveNextStep({ workflow: "spec-design", status: "blocked", runId: "001-checkout" })).toMatchObject({
      mode: "blocked",
      nextWorkflow: "spec-design",
      command: "/pipeline-orchestrator-for-codex:spec-design 001-checkout",
    });
  });

  it("renders a stable NEXT_STEP block for skill outputs and ATDD assertions", () => {
    const block = renderNextStepBlock(resolveNextStep({
      workflow: "spec-tasks",
      status: "passed",
      runId: "001-checkout",
      complexity: "MEDIA",
    }));

    expect(block).toContain("NEXT_STEP:");
    expect(block).toContain("status: passed");
    expect(block).toContain("mode: suggest");
    expect(block).toContain("next_workflow: spec-light");
    expect(block).toContain("command: /pipeline-orchestrator-for-codex:spec-light 001-checkout");
  });
});
