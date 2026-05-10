import type { DispatchResult, RunRoleResult } from "../dispatcher/dispatcher-types.js";
import { createGateLog } from "../state/gate-log.js";
import { createProtocolEventLog, parseProtocolBlocks, type ProtocolBlock } from "./protocol-events.js";

type DispatchLike = DispatchResult | RunRoleResult;

function blockIdentifier(block: ProtocolBlock) {
  if (block.kind === "GATE_REQUEST") return block.gate_id;
  if (block.kind === "DISPATCH_REQUEST") return block.dispatch_id;
  return block.plan_id;
}

function outputText(output: Record<string, unknown>) {
  return Object.values(output)
    .filter((value): value is string => typeof value === "string")
    .join("\n\n");
}

export async function persistProtocolBlocksFromDispatch(input: {
  stateRoot: string;
  dispatch: DispatchLike;
  source?: string;
}) {
  const blocks = parseProtocolBlocks(outputText(input.dispatch.output));
  if (blocks.length === 0) {
    return [];
  }

  const log = createProtocolEventLog(input.stateRoot);
  const timestamp = new Date().toISOString();

  for (const block of blocks) {
    const id = blockIdentifier(block);
    await log.append({
      event_id: `${block.kind.toLowerCase()}-${id}-emitted`,
      kind: block.kind,
      protocol_version: 1,
      status: "emitted",
      source: input.source ?? input.dispatch.role,
      timestamp,
      payload: block,
      execution_identity: input.dispatch.executionIdentity,
    });
  }

  return blocks;
}

function canonicalGateForGateId(gateId: string) {
  if (/^phase-2-tdd-approval-/u.test(gateId)) {
    return { gate: "TDD_APPROVAL", hardness: "HARD" as const, phase: "phase-2" };
  }
  if (gateId === "phase-1-5-plan-approval") {
    return { gate: "PLAN_REJECTED", hardness: "HARD" as const, phase: "phase-1.5" };
  }
  if (/^phase-2-adversarial-batch-\d+/u.test(gateId)) {
    return { gate: "ADVERSARIAL_GATE", hardness: "SOFT" as const, phase: "phase-2" };
  }
  if (gateId === "phase-3-final-adversarial") {
    return { gate: "FINAL_ADVERSARIAL_GATE", hardness: "SOFT" as const, phase: "phase-3" };
  }
  if (gateId === "phase-3-closeout") {
    return { gate: "CLOSEOUT_CONFIRM", hardness: "SOFT" as const, phase: "phase-3" };
  }
  if (/^phase-0-info-gate-/u.test(gateId)) {
    return { gate: "INFO_GATE_BLOCKED", hardness: "HARD" as const, phase: "phase-0" };
  }
  return undefined;
}

function decisionFromSelectedLabel(selectedLabel: string) {
  const normalized = selectedLabel.toLowerCase();
  if (/\b(no|nao|não|reject|rejeitar|block|bloquear|abort|abortar|go no|no-go)\b/u.test(normalized)) {
    return "block" as const;
  }
  if (/\b(skip|pular)\b/u.test(normalized)) {
    return "skip" as const;
  }
  if (/\b(partial|conditional|condicional|ajust|revise|revisar)\b/u.test(normalized)) {
    return "partial" as const;
  }
  return "pass" as const;
}

export async function recordProtocolGateResponse(input: {
  stateRoot: string;
  gateId: string;
  selectedLabel: string;
  selectedIndex?: number;
  userNotes?: string;
  source?: string;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const eventLog = createProtocolEventLog(input.stateRoot);
  await eventLog.append({
    event_id: `gate-request-${input.gateId}-answered`,
    kind: "GATE_REQUEST",
    protocol_version: 1,
    status: "answered",
    source: input.source ?? "gate_request_protocol_parent_handler",
    timestamp,
    payload: {
      gate_id: input.gateId,
      selected_label: input.selectedLabel,
      selected_index: input.selectedIndex,
      user_notes: input.userNotes,
    },
  });

  const canonical = canonicalGateForGateId(input.gateId);
  if (!canonical) {
    return { protocolEventWritten: true, canonicalGateWritten: false as const };
  }

  await createGateLog(input.stateRoot).append({
    ...canonical,
    decision: decisionFromSelectedLabel(input.selectedLabel),
    decided_by: "user",
    timestamp,
    detail: `via protocol-events GATE_REQUEST gate_id=${input.gateId}`,
    confidence_impact: 0,
  });

  return { protocolEventWritten: true, canonicalGateWritten: true as const };
}
