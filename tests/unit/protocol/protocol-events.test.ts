import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createProtocolEventLog,
  parseProtocolBlocks,
  protocolEventSchema,
} from "../../../src/protocol/protocol-events.js";
import { recordProtocolGateResponse } from "../../../src/protocol/protocol-handler.js";

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
});
