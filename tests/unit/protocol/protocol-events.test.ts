import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createProtocolEventLog,
  parseProtocolBlocks,
  protocolEventSchema,
} from "../../../src/protocol/protocol-events.js";
import {
  processProtocolBlocksForParent,
  recordProtocolGateResponse,
} from "../../../src/protocol/protocol-handler.js";

describe("v5.2 protocol event contract", () => {
  it("parses GATE_REQUEST, DISPATCH_REQUEST, and PLAN_MODE_REQUEST blocks", () => {
    const blocks = parseProtocolBlocks(`
=== GATE_REQUEST v1 ===
gate_id: phase-1-proposal
question: Proceed with the pipeline?
header: Decide
multi_select: false
options:
  - label: yes
    description: Continue now.
    recommended: true
  - label: adjust
    description: Revise the plan.
    recommended: false
  - label: no
    description: Stop here.
    recommended: false
source: pipeline-controller
=== END GATE_REQUEST ===

=== DISPATCH_REQUEST v1 ===
dispatch_id: phase-0-task-orchestrator
target_kind: agent
target_name: task-orchestrator
description: Classify the request
prompt: |
  Classify this task.
source: pipeline-controller
=== END DISPATCH_REQUEST ===

=== PLAN_MODE_REQUEST v1 ===
plan_id: phase-1-5-plan
research_scope: |
  MEDIA task requires implementation planning.
expected_deliverables:
  - implementation plan
source: pipeline-controller
=== END PLAN_MODE_REQUEST ===
`);

    expect(blocks.map((block) => block.kind)).toEqual([
      "GATE_REQUEST",
      "DISPATCH_REQUEST",
      "PLAN_MODE_REQUEST",
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "GATE_REQUEST",
      gate_id: "phase-1-proposal",
      question: "Proceed with the pipeline?",
      options: [
        { label: "yes", description: "Continue now.", recommended: true },
        { label: "adjust", description: "Revise the plan.", recommended: false },
        { label: "no", description: "Stop here.", recommended: false },
      ],
    });
    expect(blocks[1]).toMatchObject({
      kind: "DISPATCH_REQUEST",
      dispatch_id: "phase-0-task-orchestrator",
      target_kind: "agent",
      target_name: "task-orchestrator",
      phase: "unknown",
    });
    expect(blocks[2]).toMatchObject({
      kind: "PLAN_MODE_REQUEST",
      plan_id: "phase-1-5-plan",
      research_scope: "MEDIA task requires implementation planning.\n",
    });
  });

  it("rejects GATE_REQUEST blocks with fewer than two options", () => {
    expect(() => parseProtocolBlocks(`
=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q1
question: What decision is missing?
header: Decide
options:
  - label: Continue
    description: Continue with the inferred direction.
    recommended: true
source: brainstorm-controller
=== END GATE_REQUEST ===
`)).toThrow(/at least two meaningful options/i);
  });

  it("rejects GATE_REQUEST options without trade-off descriptions", () => {
    expect(() => parseProtocolBlocks(`
=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q1
question: What decision is missing?
header: Decide
options:
  - Continue
  - Stop
source: brainstorm-controller
=== END GATE_REQUEST ===
`)).toThrow(/Expected object/i);

    expect(() => parseProtocolBlocks(`
=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q2
question: Which scope should we use?
header: Scope
options:
  - label: Narrow
    description: ""
    recommended: true
  - label: Broad
    description: Include adjacent decisions now.
    recommended: false
source: brainstorm-controller
=== END GATE_REQUEST ===
`)).toThrow(/non-empty trade-off description/i);
  });

  it("rejects GATE_REQUEST blocks with multiple recommended options", () => {
    expect(() => parseProtocolBlocks(`
=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q3
question: Which scope should we use?
header: Scope
options:
  - label: Narrow
    description: Keep the first version small.
    recommended: true
  - label: Broad
    description: Include adjacent decisions now.
    recommended: true
source: brainstorm-controller
=== END GATE_REQUEST ===
`)).toThrow(/at most one option as recommended/i);
  });

  it("persists protocol-events.jsonl separately from gate-decisions.jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-protocol-events-"));
    const log = createProtocolEventLog(root);
    const event = protocolEventSchema.parse({
      event_id: "evt-1",
      kind: "GATE_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "pipeline-controller",
      timestamp: "2026-05-10T00:00:00.000Z",
      payload: { gate_id: "phase-1-proposal" },
    });

    await log.append(event);

    const raw = await readFile(join(root, "protocol-events.jsonl"), "utf8");
    expect(raw).toContain("\"kind\":\"GATE_REQUEST\"");
    await expect(readFile(join(root, "gate-decisions.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(log.list()).resolves.toHaveLength(1);
  });

  it("dual-writes answered named gate requests to the canonical gate log", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-protocol-events-"));

    const result = await recordProtocolGateResponse({
      stateRoot: root,
      gateId: "phase-3-closeout",
      selectedLabel: "GO",
      selectedIndex: 0,
      timestamp: "2026-05-10T00:00:00.000Z",
    });

    expect(result).toEqual({ protocolEventWritten: true, canonicalGateWritten: true });
    const protocolRaw = await readFile(join(root, "protocol-events.jsonl"), "utf8");
    const gateRaw = await readFile(join(root, "gate-decisions.jsonl"), "utf8");
    expect(protocolRaw).toContain("\"status\":\"answered\"");
    expect(gateRaw).toContain("\"gate\":\"CLOSEOUT_CONFIRM\"");
    expect(gateRaw).toContain("\"decision\":\"pass\"");
    expect(gateRaw).toContain("gate_id=phase-3-closeout");
  });

  it("parent handler dispatches agents, answers gates, fulfills plan requests, and logs actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-protocol-parent-"));
    const blocks = parseProtocolBlocks(`=== DISPATCH_REQUEST v1 ===
dispatch_id: dispatch-1
target_kind: agent
target_name: pipeline-orchestrator-for-codex:core:information-gate
description: Ask one question
prompt: Ask one question at a time.
phase: phase-0
=== END DISPATCH_REQUEST ===

=== GATE_REQUEST v1 ===
gate_id: phase-2-adversarial-batch-1
question: Continue?
header: Review
options:
  - label: Continue
    description: Continue after review.
    recommended: true
  - label: Block
    description: Stop for fixes.
    recommended: false
=== END GATE_REQUEST ===

=== PLAN_MODE_REQUEST v1 ===
plan_id: plan-1
research_scope: Inspect affected files.
expected_deliverables:
  - Implementation plan
=== END PLAN_MODE_REQUEST ===`);

    const result = await processProtocolBlocksForParent({
      stateRoot: root,
      blocks,
      adapters: {
        async dispatchAgent(request) {
          return {
            targetName: request.targetName,
            output: "INFORMATION_GATE\nSTATUS: passed",
          };
        },
        async answerGate(request) {
          return {
            gateId: request.gateId,
            selectedLabel: request.options[0].label,
            selectedIndex: 0,
          };
        },
        async fulfillPlanMode(request) {
          return {
            planId: request.planId,
            output: `Plan for ${request.researchScope}`,
          };
        },
      },
    });

    expect(result.dispatchResults).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-1",
        targetName: "pipeline-orchestrator-for-codex:core:information-gate",
      }),
    ]);
    expect(result.gateResponses).toEqual([
      expect.objectContaining({
        gateId: "phase-2-adversarial-batch-1",
        selectedLabel: "Continue",
      }),
    ]);
    expect(result.planModeResults).toEqual([
      expect.objectContaining({
        planId: "plan-1",
        output: "Plan for Inspect affected files.",
      }),
    ]);

    const rawEvents = await readFile(join(root, "protocol-events.jsonl"), "utf8");
    expect(rawEvents).toContain("\"status\":\"dispatched\"");
    expect(rawEvents).toContain("\"status\":\"completed\"");
    expect(rawEvents).toContain("\"status\":\"answered\"");
  });
});

// Spec: pipeline-trust-restoration / R5 — Post-Mortem Distinguishability in Protocol Events
describe("R5: protocol event dispatchMode field", () => {
  it("R5 AC 5.2: schema accepts dispatchMode='real'", () => {
    const parsed = protocolEventSchema.parse({
      event_id: "dispatch-request-x-emitted",
      kind: "DISPATCH_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "test",
      timestamp: new Date().toISOString(),
      payload: {},
      dispatchMode: "real",
    });
    expect(parsed.dispatchMode).toBe("real");
  });

  it("R5 AC 5.2: schema accepts dispatchMode='emulated'", () => {
    const parsed = protocolEventSchema.parse({
      event_id: "dispatch-request-x-emitted",
      kind: "DISPATCH_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "test",
      timestamp: new Date().toISOString(),
      payload: {},
      dispatchMode: "emulated",
    });
    expect(parsed.dispatchMode).toBe("emulated");
  });

  it("R5 AC 5.5: schema accepts legacy entries without dispatchMode (backward-compat)", () => {
    const parsed = protocolEventSchema.parse({
      event_id: "dispatch-request-legacy",
      kind: "DISPATCH_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "test",
      timestamp: new Date().toISOString(),
      payload: {},
    });
    expect(parsed.dispatchMode).toBeUndefined();
  });

  it("schema rejects invalid dispatchMode value", () => {
    expect(() =>
      protocolEventSchema.parse({
        event_id: "x",
        kind: "DISPATCH_REQUEST",
        protocol_version: 1,
        status: "emitted",
        source: "test",
        timestamp: new Date().toISOString(),
        payload: {},
        dispatchMode: "magic",
      }),
    ).toThrow();
  });

  it("R5 AC 5.5: parser allows reading legacy entries (no dispatchMode) and the consumer can tag them as 'unknown'", async () => {
    const root = await mkdtemp(join(tmpdir(), "protocol-events-r5-"));
    const log = createProtocolEventLog(root);
    await log.append({
      event_id: "legacy-dispatch",
      kind: "DISPATCH_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "test",
      timestamp: new Date().toISOString(),
      payload: { dispatch_id: "abc" },
    });

    const events = await log.list();
    const tagged = events.map((event) => ({
      ...event,
      dispatchMode: event.dispatchMode ?? "unknown",
    }));
    expect(tagged[0].dispatchMode).toBe("unknown");
  });

  it("dispatchMode persists through the writer when supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "protocol-events-r5-"));
    const log = createProtocolEventLog(root);
    await log.append({
      event_id: "real-dispatch",
      kind: "DISPATCH_REQUEST",
      protocol_version: 1,
      status: "emitted",
      source: "test",
      timestamp: new Date().toISOString(),
      payload: { dispatch_id: "xyz" },
      dispatchMode: "real",
    });
    const raw = await readFile(join(root, "protocol-events.jsonl"), "utf8");
    expect(raw).toContain('"dispatchMode":"real"');
  });
});
