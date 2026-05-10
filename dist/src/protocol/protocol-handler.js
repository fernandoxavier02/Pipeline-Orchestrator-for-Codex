import { createGateLog } from "../state/gate-log.js";
import { createProtocolEventLog, parseProtocolBlocks } from "./protocol-events.js";
function blockIdentifier(block) {
    if (block.kind === "GATE_REQUEST")
        return block.gate_id;
    if (block.kind === "DISPATCH_REQUEST")
        return block.dispatch_id;
    return block.plan_id;
}
function outputText(output) {
    return Object.values(output)
        .filter((value) => typeof value === "string")
        .join("\n\n");
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
        });
    }
    return blocks;
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
function decisionFromSelectedLabel(selectedLabel) {
    const normalized = selectedLabel.toLowerCase();
    if (/\b(no|nao|não|reject|rejeitar|block|bloquear|abort|abortar|go no|no-go)\b/u.test(normalized)) {
        return "block";
    }
    if (/\b(skip|pular)\b/u.test(normalized)) {
        return "skip";
    }
    if (/\b(partial|conditional|condicional|ajust|revise|revisar)\b/u.test(normalized)) {
        return "partial";
    }
    return "pass";
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
        decided_by: "user",
        timestamp,
        detail: `via protocol-events GATE_REQUEST gate_id=${input.gateId}`,
        confidence_impact: 0,
    });
    return { protocolEventWritten: true, canonicalGateWritten: true };
}
