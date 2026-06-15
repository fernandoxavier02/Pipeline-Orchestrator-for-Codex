import { describe, expect, it } from "vitest";
import {
  REQUIRED_PIPELINE_GATES,
  REQUIRED_PIPELINE_HOOKS,
} from "../../../src/governance/pipeline-contract.js";
import {
  evaluateWorkflowEvidence,
  requiredWorkflowEventsFromArtifact,
} from "../../../src/governance/workflow-enforcement.js";

function passingGateEvents() {
  return REQUIRED_PIPELINE_GATES.map((gate) => ({
    kind: "gate" as const,
    id: gate,
    phase: "phase-3" as const,
    status: "PASS" as const,
  }));
}

function passingHookEvents() {
  return REQUIRED_PIPELINE_HOOKS.map((checkpoint) => ({
    kind: "hook" as const,
    id: checkpoint,
    phase: "phase-3" as const,
    status: "PASS" as const,
  }));
}

function passingReviewerEvents() {
  return [
    {
      kind: "agent" as const,
      id: "primary_reviewer",
      phase: "phase-2" as const,
      status: "PASS" as const,
      independent: true,
    },
    {
      kind: "agent" as const,
      id: "adversarial_reviewer",
      phase: "phase-2" as const,
      status: "PASS" as const,
      independent: true,
    },
  ];
}

describe("workflow enforcement spine", () => {
  it("TDD: blocks when a mandatory gate is missing", () => {
    const evidence = evaluateWorkflowEvidence({
      events: [
        ...passingGateEvents().filter((event) => event.id !== "FINAL_VERDICT_GATE"),
        ...passingHookEvents(),
        ...passingReviewerEvents(),
        {
          kind: "final_verdict",
          id: "final_verdict",
          phase: "phase-3",
          status: "PASS",
        },
      ],
      requireAdversarialReview: true,
    });

    expect(evidence.status).toBe("BLOCKED");
    expect(evidence.missingEvents).toContain("gate:FINAL_VERDICT_GATE");
  });

  it("ATDD: accepts explicit pipeline evidence only when gates, hooks, agents, and final verdict are complete", () => {
    const evidence = evaluateWorkflowEvidence({
      events: [
        ...passingReviewerEvents(),
        ...passingGateEvents(),
        ...passingHookEvents(),
        {
          kind: "final_verdict",
          id: "final_verdict",
          phase: "phase-3",
          status: "PASS",
        },
      ],
      requireAdversarialReview: true,
    });

    expect(evidence).toMatchObject({
      status: "PASS",
      missingEvents: [],
      failedEvents: [],
    });
  });

  it("BDD: blocks when execution jumps from phase-3 back to phase-1", () => {
    const evidence = evaluateWorkflowEvidence({
      events: [
        {
          kind: "gate",
          id: "CAPABILITY_GATE",
          phase: "phase-3",
          status: "PASS",
        },
        {
          kind: "gate",
          id: "INTAKE_GATE",
          phase: "phase-1",
          status: "PASS",
        },
      ],
    });

    expect(evidence.status).toBe("BLOCKED");
    expect(evidence.sequenceErrors[0]).toContain("phase regression");
  });

  it("DDD: projects a PipelineGovernanceArtifact into domain workflow evidence", () => {
    const events = requiredWorkflowEventsFromArtifact({
      gates: REQUIRED_PIPELINE_GATES.map((gate) => ({
        gate,
        status: "PASS",
        reason: `${gate} passed.`,
        evidence_ref: `gate:${gate}`,
      })),
      hooks: REQUIRED_PIPELINE_HOOKS.map((checkpoint) => ({
        checkpoint,
        status: "PASS",
        reason: `${checkpoint} passed.`,
        evidence_ref: `hook:${checkpoint}`,
      })),
      agents: [
        {
          role: "primary_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:primary",
          independent: true,
        },
        {
          role: "adversarial_reviewer",
          status: "PASS",
          dispatch_ref: "dispatch:adversarial",
          independent: true,
        },
      ],
      final_verdict: {
        status: "PASS",
        reason: "Complete.",
        evidence_ref: "final",
      },
    });

    expect(events.some((event) => event.kind === "gate" && event.id === "CAPABILITY_GATE")).toBe(true);
    expect(events.some((event) => event.kind === "final_verdict" && event.status === "PASS")).toBe(true);
  });
});
