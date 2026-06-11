import { createGateLog, inferDecidedBy } from "../state/gate-log.js";
import { createProtocolEventLog, parseProtocolBlocks, } from "./protocol-events.js";
import { buildPlanModeBypassRedispatchPrompt, mandatoryPlanModeAgentForTarget, outputCarriesPlanModeRequest, outputContainsSubstantiveMarker, promptCarriesPlanModeBypassRedispatch, promptCarriesPlanModeResults, } from "./plan-mode-bypass.js";
function blockIdentifier(block) {
    if (block.kind === "GATE_REQUEST")
        return block.gate_id;
    if (block.kind === "DISPATCH_REQUEST")
        return block.dispatch_id;
    return block.plan_id;
}
function collectStringValues(value) {
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
function outputText(output) {
    return collectStringValues(output).join("\n\n");
}
async function enforcePlanModeBypass(input) {
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
export async function persistProtocolBlocksFromDispatch(input) {
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
export async function processProtocolBlocksForParent(input) {
    const log = createProtocolEventLog(input.stateRoot);
    const timestamp = new Date().toISOString();
    const dispatchResults = [];
    const gateResponses = [];
    const planModeResults = [];
    async function fulfillPlanModeBlock(block) {
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
            const request = {
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
            const dispatchWithAdapters = async (nextRequest) => (nextRequest.targetKind === "skill"
                ? await input.adapters.dispatchSkill?.(nextRequest)
                : await input.adapters.dispatchAgent(nextRequest));
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
                .filter((nestedBlock) => nestedBlock.kind === "PLAN_MODE_REQUEST");
            const nestedPlanModeResults = [];
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
function canonicalGateForGateId(gateId) {
    if (/^phase-2-tdd-approval-/u.test(gateId)) {
        return { gate: "TDD_APPROVAL", hardness: "HARD", phase: "phase-2" };
    }
    if (gateId === "phase-1-5-plan-approval") {
        return { gate: "PLAN_REJECTED", hardness: "HARD", phase: "phase-1.5" };
    }
    if (/^phase-2-adversarial-batch-\d+/u.test(gateId)) {
        return { gate: "ADVERSARIAL_GATE", hardness: "SOFT", phase: "phase-2" };
    }
    if (gateId === "phase-3-final-adversarial") {
        return { gate: "FINAL_ADVERSARIAL_GATE", hardness: "SOFT", phase: "phase-3" };
    }
    if (gateId === "phase-3-closeout") {
        return { gate: "CLOSEOUT_CONFIRM", hardness: "SOFT", phase: "phase-3" };
    }
    if (/^phase-0-info-gate-/u.test(gateId)) {
        return { gate: "INFO_GATE_BLOCKED", hardness: "HARD", phase: "phase-0" };
    }
    return undefined;
}
// Post-review fix (SEC-005): the previous default was `"pass"` for any label
// that did not match a block/skip/partial keyword. That inverts the fail-safe
// principle for gate decisions — a compromised agent could craft a label
// outside the known keyword set and silently forge a gate-pass entry. The
// new default is `"block"`: only explicit approval keywords (yes / approve /
// continue / etc.) map to `"pass"`. Unknown labels are treated as a block
// so the gate stays closed until the user confirms.
function decisionFromSelectedLabel(selectedLabel) {
    const normalized = selectedLabel.toLowerCase();
    if (/\b(yes|sim|approve|aprovar|approved|continue|continuar|go|proceed|prosseguir|ok|confirm|confirmar)\b/u.test(normalized)) {
        return "pass";
    }
    if (/\b(skip|pular)\b/u.test(normalized)) {
        return "skip";
    }
    if (/\b(partial|conditional|condicional|ajust|revise|revisar)\b/u.test(normalized)) {
        return "partial";
    }
    // Default block: includes the prior block keywords (no / reject / abort /
    // no-go) and any unrecognised label (fail-safe).
    return "block";
}
export async function recordProtocolGateResponse(input) {
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
        return { protocolEventWritten: true, canonicalGateWritten: false };
    }
    await createGateLog(input.stateRoot).append({
        ...canonical,
        decision: decisionFromSelectedLabel(input.selectedLabel),
        decided_by: inferDecidedBy({ source: "user" }),
        timestamp,
        detail: `via protocol-events GATE_REQUEST gate_id=${input.gateId}`,
        confidence_impact: 0,
    });
    return { protocolEventWritten: true, canonicalGateWritten: true };
}
