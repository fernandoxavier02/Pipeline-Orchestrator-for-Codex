import type { DispatchResult, RunRoleResult } from "../dispatcher/dispatcher-types.js";
import {
  createGateLog,
  inferDecidedBy,
  normalizeCanonicalGateDecision,
  type CanonicalGateDecision,
} from "../state/gate-log.js";
import {
  createProtocolEventLog,
  parseProtocolBlocks,
  type ProtocolBlock,
  type ProtocolDispatchMode,
} from "./protocol-events.js";
import {
  buildPlanModeBypassRedispatchPrompt,
  mandatoryPlanModeAgentForTarget,
  outputCarriesPlanModeRequest,
  outputContainsSubstantiveMarker,
  promptCarriesPlanModeBypassRedispatch,
  promptCarriesPlanModeResults,
} from "./plan-mode-bypass.js";

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

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStringValues(item));
  }
  return [];
}

function outputText(output: Record<string, unknown>) {
  return collectStringValues(output).join("\n\n");
}

async function enforcePlanModeBypass(input: {
  stateRoot: string;
  request: ParentDispatchRequest;
  output: Record<string, unknown>;
  dispatchAgain: (request: ParentDispatchRequest) => Promise<Record<string, unknown>>;
  source?: string;
  dispatchMode?: ProtocolDispatchMode;
}) {
  const agent = mandatoryPlanModeAgentForTarget(input.request.targetName);
  if (!agent || promptCarriesPlanModeResults(input.request.prompt)) {
    return input.output;
  }

  const text = outputText(input.output);
  if (!outputContainsSubstantiveMarker(text, agent) || outputCarriesPlanModeRequest(text)) {
    return input.output;
  }

  const log = createProtocolEventLog(input.stateRoot);
  const timestamp = new Date().toISOString();
  await log.append({
    event_id: `plan-mode-bypass-${input.request.dispatchId}`,
    kind: "DISPATCH_REQUEST",
    protocol_version: 1,
    status: "failed",
    source: input.source ?? "protocol-parent-handler",
    timestamp,
    payload: {
      event: "PLAN_MODE_BYPASS",
      dispatchId: input.request.dispatchId,
      targetName: input.request.targetName,
      markers: agent.outputMarkers,
      redispatch: !promptCarriesPlanModeBypassRedispatch(input.request.prompt),
    },
    ...(input.dispatchMode ? { dispatchMode: input.dispatchMode } : {}),
  });

  if (promptCarriesPlanModeBypassRedispatch(input.request.prompt)) {
    return {
      ...input.output,
      status: "blocked",
      protocolStatus: "blocked-plan-mode-bypass",
      blockedReason: `PLAN_MODE_BYPASS: ${input.request.targetName} emitted substantive output before PLAN_MODE_REQUEST twice.`,
      attemptedOutputText: text,
    };
  }

  const retryOutput = await input.dispatchAgain({
    ...input.request,
    prompt: buildPlanModeBypassRedispatchPrompt({
      originalPrompt: input.request.prompt,
      targetName: input.request.targetName,
      markers: agent.outputMarkers,
    }),
  });
  const retryText = outputText(retryOutput);
  if (outputContainsSubstantiveMarker(retryText, agent) && !outputCarriesPlanModeRequest(retryText)) {
    return {
      ...retryOutput,
      status: "blocked",
      protocolStatus: "blocked-plan-mode-bypass",
      blockedReason: `PLAN_MODE_BYPASS: ${input.request.targetName} emitted substantive output before PLAN_MODE_REQUEST twice.`,
      attemptedOutputText: retryText,
    };
  }

  return {
    ...retryOutput,
    planModeBypassRecovered: true,
  };
}

export async function persistProtocolBlocksFromDispatch(input: {
  stateRoot: string;
  dispatch: DispatchLike;
  source?: string;
  // R5 — Caller passes dispatchMode so the persisted DISPATCH_REQUEST events
  // record whether the producing dispatch was real or emulated. Other event
  // kinds (GATE_REQUEST, PLAN_MODE_REQUEST) do not require this tag.
  dispatchMode?: ProtocolDispatchMode;
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
      ...(block.kind === "DISPATCH_REQUEST" && input.dispatchMode
        ? { dispatchMode: input.dispatchMode }
        : {}),
    });
  }

  return blocks;
}

export async function processProtocolBlocksForParent(input: {
  stateRoot: string;
  blocks: ProtocolBlock[];
  adapters: ParentProtocolAdapters;
  source?: string;
  // R5 — Caller passes dispatchMode so child DISPATCH_REQUEST events are
  // tagged with the runtime mode of the parent re-dispatch.
  dispatchMode?: ProtocolDispatchMode;
}) {
  const log = createProtocolEventLog(input.stateRoot);
  const timestamp = new Date().toISOString();
  const dispatchResults: Array<Record<string, unknown>> = [];
  const gateResponses: Array<Record<string, unknown>> = [];
  const planModeResults: Array<Record<string, unknown>> = [];

  async function fulfillPlanModeBlock(block: Extract<ProtocolBlock, { kind: "PLAN_MODE_REQUEST" }>) {
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
    return normalized;
  }

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
        ...(input.dispatchMode ? { dispatchMode: input.dispatchMode } : {}),
      });
      const dispatchWithAdapters = async (nextRequest: ParentDispatchRequest) => (
        nextRequest.targetKind === "skill"
          ? await input.adapters.dispatchSkill?.(nextRequest)
          : await input.adapters.dispatchAgent(nextRequest)
      );
      const rawOutput = await dispatchWithAdapters(request);

      if (!rawOutput) {
        throw new Error(`DISPATCH_REQUEST ${block.dispatch_id} could not be processed by the parent handler.`);
      }
      const output = await enforcePlanModeBypass({
        stateRoot: input.stateRoot,
        request,
        output: rawOutput,
        dispatchAgain: async (nextRequest) => {
          const retryOutput = await dispatchWithAdapters(nextRequest);
          if (!retryOutput) {
            throw new Error(`DISPATCH_REQUEST ${block.dispatch_id} retry could not be processed by the parent handler.`);
          }
          return retryOutput;
        },
        source: input.source,
        dispatchMode: input.dispatchMode,
      });
      const nestedPlanModeBlocks = parseProtocolBlocks(outputText(output))
        .filter((nestedBlock): nestedBlock is Extract<ProtocolBlock, { kind: "PLAN_MODE_REQUEST" }> =>
          nestedBlock.kind === "PLAN_MODE_REQUEST"
        );
      const nestedPlanModeResults: Array<Record<string, unknown>> = [];
      for (const nestedBlock of nestedPlanModeBlocks) {
        await log.append({
          event_id: `plan-mode-request-${nestedBlock.plan_id}-emitted-from-dispatch-${block.dispatch_id}`,
          kind: "PLAN_MODE_REQUEST",
          protocol_version: 1,
          status: "emitted",
          source: input.source ?? "protocol-parent-handler",
          timestamp: new Date().toISOString(),
          payload: nestedBlock,
        });
        nestedPlanModeResults.push(await fulfillPlanModeBlock(nestedBlock));
      }
      const completedOutput = nestedPlanModeResults.length > 0
        ? {
          ...output,
          planModeResults: nestedPlanModeResults,
        }
        : output;

      const result = {
        dispatchId: block.dispatch_id,
        targetKind: block.target_kind,
        targetName: block.target_name,
        output: completedOutput,
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
        ...(input.dispatchMode ? { dispatchMode: input.dispatchMode } : {}),
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

    await fulfillPlanModeBlock(block);
  }

  return {
    dispatchResults,
    gateResponses,
    planModeResults,
  };
}

function canonicalGateForGateId(gateId: string) {
  if (/^proposal-confirmation-/u.test(gateId)) {
    return { gate: "SCOPE_GATE", hardness: "MANDATORY" as const, phase: "phase-1" };
  }
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

// Post-review fix (SEC-005): unknown labels must stay fail-closed. Labels are
// first classified in the canonical 8-value vocabulary, then normalized by the
// gate-log writer helper into the local persisted subset.
function canonicalDecisionFromSelectedLabel(selectedLabel: string): CanonicalGateDecision {
  const normalized = selectedLabel.toLowerCase();
  const canonicalLabel = selectedLabel.trim().toUpperCase();
  if (
    canonicalLabel === "BLOCKED"
    || canonicalLabel === "DISPATCHED"
    || canonicalLabel === "SKIPPED"
    || canonicalLabel === "APPROVED"
    || canonicalLabel === "CONFIRMED"
    || canonicalLabel === "REJECTED"
    || canonicalLabel === "TRIGGERED"
    || canonicalLabel === "NOT_TRIGGERED"
  ) {
    return canonicalLabel;
  }
  if (/\b(yes|sim|approve|aprovar|approved|continue|continuar|go|proceed|prosseguir|ok|confirm|confirmar)\b/u.test(normalized)) {
    return "APPROVED";
  }
  if (/\b(skip|pular)\b/u.test(normalized)) {
    return "SKIPPED";
  }
  if (/\b(triggered|partial|conditional|condicional|ajust|revise|revisar)\b/u.test(normalized)) {
    return "TRIGGERED";
  }
  // Default block: includes block keywords (no / reject / abort / no-go) and
  // any unrecognised label.
  return "BLOCKED";
}

function decisionFromSelectedLabel(selectedLabel: string) {
  return normalizeCanonicalGateDecision(canonicalDecisionFromSelectedLabel(selectedLabel));
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
    decided_by: inferDecidedBy({ source: "user" }),
    timestamp,
    detail: `via protocol-events GATE_REQUEST gate_id=${input.gateId}`,
    confidence_impact: 0,
  });

  return { protocolEventWritten: true, canonicalGateWritten: true as const };
}
