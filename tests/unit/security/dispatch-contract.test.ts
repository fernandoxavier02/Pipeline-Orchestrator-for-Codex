import { describe, expect, it } from "vitest";
import {
  AGENT_LEAF_TO_FQN,
  PIPELINE_NAMESPACE,
  evaluateAgentDispatch,
  evaluateSkillDispatch,
  fqnFor,
  isFullyQualifiedPipelineAgent,
  isPipelineAgentLeaf,
} from "../../../src/security/dispatch-contract.js";

describe("dispatch-contract value object", () => {
  it("AGENT_LEAF_TO_FQN uses the codex namespace exclusively", () => {
    for (const [leaf, fqn] of Object.entries(AGENT_LEAF_TO_FQN)) {
      expect(fqn.startsWith(`${PIPELINE_NAMESPACE}:`)).toBe(true);
      expect(fqn.endsWith(`:${leaf}`)).toBe(true);
      expect(fqn.includes(":pipeline-orchestrator:")).toBe(false);
    }
  });

  it("AGENT_LEAF_TO_FQN is frozen and contains task-orchestrator + sentinel + finishing-branch", () => {
    expect(Object.isFrozen(AGENT_LEAF_TO_FQN)).toBe(true);
    expect(AGENT_LEAF_TO_FQN["task-orchestrator"]).toBe(
      `${PIPELINE_NAMESPACE}:core:task-orchestrator`,
    );
    expect(AGENT_LEAF_TO_FQN["sentinel"]).toBe(`${PIPELINE_NAMESPACE}:core:sentinel`);
    expect(AGENT_LEAF_TO_FQN["finishing-branch"]).toBe(
      `${PIPELINE_NAMESPACE}:core:finishing-branch`,
    );
  });

  it("isPipelineAgentLeaf / fqnFor cover known and unknown leaves", () => {
    expect(isPipelineAgentLeaf("task-orchestrator")).toBe(true);
    expect(isPipelineAgentLeaf("not-a-pipeline-agent")).toBe(false);
    expect(fqnFor("task-orchestrator")).toBe(`${PIPELINE_NAMESPACE}:core:task-orchestrator`);
    expect(fqnFor("not-a-pipeline-agent")).toBeUndefined();
  });

  it("isFullyQualifiedPipelineAgent matches only the codex namespace", () => {
    expect(isFullyQualifiedPipelineAgent(`${PIPELINE_NAMESPACE}:core:sentinel`)).toBe(true);
    expect(isFullyQualifiedPipelineAgent("pipeline-orchestrator:core:sentinel")).toBe(false);
  });
});

describe("evaluateAgentDispatch", () => {
  it("allows fully-qualified codex pipeline agents", () => {
    const verdict = evaluateAgentDispatch({
      subagentType: `${PIPELINE_NAMESPACE}:core:task-orchestrator`,
    });
    expect(verdict.kind).toBe("allow");
    if (verdict.kind === "allow") {
      expect(verdict.contract?.agentLeaf).toBe("task-orchestrator");
      expect(verdict.contract?.tool).toBe("Agent");
    }
  });

  it("blocks bare-leaf pipeline agent calls and suggests the FQN", () => {
    const verdict = evaluateAgentDispatch({ subagentType: "task-orchestrator" });
    expect(verdict.kind).toBe("block");
    if (verdict.kind === "block") {
      expect(verdict.reason).toContain(`${PIPELINE_NAMESPACE}:core:task-orchestrator`);
    }
  });

  it("blocks calls under the codex namespace whose leaf is unknown", () => {
    const verdict = evaluateAgentDispatch({
      subagentType: `${PIPELINE_NAMESPACE}:core:not-a-real-agent`,
    });
    expect(verdict.kind).toBe("block");
  });

  it("allows agents from other namespaces (no interference)", () => {
    const verdict = evaluateAgentDispatch({
      subagentType: "some-other-plugin:foo:bar",
    });
    expect(verdict.kind).toBe("allow");
  });

  it("allows when subagent_type is empty (non-pipeline tool call)", () => {
    expect(evaluateAgentDispatch({ subagentType: "" }).kind).toBe("allow");
    expect(evaluateAgentDispatch({ subagentType: undefined }).kind).toBe("allow");
  });
});

describe("evaluateSkillDispatch", () => {
  it("blocks Skill calls whose name maps to a pipeline agent leaf", () => {
    const verdict = evaluateSkillDispatch({ skillName: "task-orchestrator" });
    expect(verdict.kind).toBe("block");
    if (verdict.kind === "block") {
      expect(verdict.reason).toContain("Agent tool");
      expect(verdict.reason).toContain(`${PIPELINE_NAMESPACE}:core:task-orchestrator`);
    }
  });

  it("blocks namespaced Skill names that point at pipeline agents", () => {
    const verdict = evaluateSkillDispatch({
      skillName: `${PIPELINE_NAMESPACE}:core:sentinel`,
    });
    expect(verdict.kind).toBe("block");
  });

  it("allows non-pipeline Skill names", () => {
    expect(evaluateSkillDispatch({ skillName: "context" }).kind).toBe("allow");
    expect(evaluateSkillDispatch({ skillName: "" }).kind).toBe("allow");
  });
});
