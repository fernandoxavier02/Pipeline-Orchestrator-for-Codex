import type { DispatchResult, RunRoleResult } from "../dispatcher/dispatcher-types.js";
import { createGateLog } from "../state/gate-log.js";
import { createProtocolEventLog, parseProtocolBlocks, type ProtocolBlock } from "./protocol-events.js";

type DispatchLike = DispatchResult | RunRoleResult;

export type ParentDispatchRequest = {
  dispatchId: string;
  targetKind: "agent" | "skill";
  targetName: string;
  description?: string;
  prompt?: string;
  phase: string;
};

export type ParentGateRequest = {
  gateId: string;
  question: string;
  header?: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string; recommended: boolean }>;
  context?: string;
};

export type ParentPlanModeRequest = {
  planId: string;
  researchScope: string;
  expectedDeliverables: string[];
};

export type ParentProtocolAdapters = {
  dispatchAgent: (request: ParentDispatchRequest) => Promise<Record<string, unknown>>;
  dispatchSkill?: (request: ParentDispatchRequest) => Promise<Record<string, unknown>>;
  answerGate: (request: ParentGateRequest) => Promise<{
    gateId?: string;
    selectedLabel: string;
    selectedIndex?: number;
    userNotes?: string;
  }>;
  fulfillPlanMode: (request: ParentPlanModeRequest) => Promise<{
    planId?: string;
    output: unknown;
  }>;
};

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

export async function processProtocolBlocksForParent(input: {
  stateRoot: string;
  blocks: ProtocolBlock[];
  adapters: ParentProtocolAdapters;
  source?: string;
}) {
  const log = createProtocolEventLog(input.stateRoot);
  const timestamp = new Date().toISOString();
  const dispatchResults: Array<Record<string, unknown>> = [];
  const gateResponses: Array<Record<string, unknown>> = [];
  const planModeResults: Array<Record<string, unknown>> = [];

  for (const block of input.blocks) {
    if (block.kind === "DISPATCH_REQUEST") {
      const request: ParentDispatchRequest = {
        dispatchId: block.dispatch_id,
        targetKind: block.target_kind,
        targetName: block.target_name,
        description: block.description,
        prompt: block.prompt,
        phase: block.phase,
      };
      await log.append({
        event_id: `dispatch-request-${block.dispatch_id}-dispatched`,
        kind: "DISPATCH_REQUEST",
        protocol_version: 1,
        status: "dispatched",
        source: input.source ?? "protocol-parent-handler",
        timestamp,
        payload: request,
      });
      const output = block.target_kind === "skill"
        ? await input.adapters.dispatchSkill?.(request)
        : await input.adapters.dispatchAgent(request);

      if (!output) {
        throw new Error(`DISPATCH_REQUEST ${block.dispatch_id} could not be processed by the parent handler.`);
      }

      const result = {
        dispatchId: block.dispatch_id,
        targetKind: block.target_kind,
        targetName: block.target_name,
        output,
      };
      dispatchResults.push(result);
      await log.append({
        event_id: `dispatch-request-${block.dispatch_id}-completed`,
        kind: "DISPATCH_REQUEST",
        protocol_version: 1,
        status: "completed",
        source: input.source ?? "protocol-parent-handler",
        timestamp: new Date().toISOString(),
        payload: result,
      });
      continue;
    }

    if (block.kind === "GATE_REQUEST") {
      const response = await input.adapters.answerGate({
        gateId: block.gate_id,
        question: block.question,
        header: block.header,
        multiSelect: block.multi_select,
        options: block.options,
        context: block.context,
      });
      const normalized = {
        gateId: response.gateId ?? block.gate_id,
        selectedLabel: response.selectedLabel,
        selectedIndex: response.selectedIndex,
        userNotes: response.userNotes,
      };
      await recordProtocolGateResponse({
        stateRoot: input.stateRoot,
        gateId: normalized.gateId,
        selectedLabel: normalized.selectedLabel,
        selectedIndex: normalized.selectedIndex,
        userNotes: normalized.userNotes,
        source: input.source ?? "protocol-parent-handler",
      });
      gateResponses.push(normalized);
      continue;
    }

    const planResult = await input.adapters.fulfillPlanMode({
      planId: block.plan_id,
      researchScope: block.research_scope,
      expectedDeliverables: block.expected_deliverables,
    });
    const normalized = {
      planId: planResult.planId ?? block.plan_id,
      output: planResult.output,
    };
    planModeResults.push(normalized);
    await log.append({
      event_id: `plan-mode-request-${block.plan_id}-completed`,
      kind: "PLAN_MODE_REQUEST",
      protocol_version: 1,
      status: "completed",
      source: input.source ?? "protocol-parent-handler",
      timestamp: new Date().toISOString(),
      payload: normalized,
    });
  }

  return {
    dispatchResults,
    gateResponses,
    planModeResults,
  };
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
