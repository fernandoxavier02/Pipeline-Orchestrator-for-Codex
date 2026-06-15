function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function collectStrings(value, depth = 0) {
    if (depth > 8 || value === undefined || value === null) {
        return [];
    }
    if (typeof value === "string") {
        return [value];
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectStrings(entry, depth + 1));
    }
    if (typeof value === "object") {
        return Object.values(value).flatMap((entry) => collectStrings(entry, depth + 1));
    }
    return [];
}
function hasString(value, expected) {
    return collectStrings(value).some((candidate) => candidate === expected);
}
function hasAnyString(value, expected) {
    return expected.some((entry) => hasString(value, entry));
}
function isPassDecision(value) {
    return value === "pass"
        || value === "PASS"
        || value === "approved"
        || value === "APPROVED"
        || value === "confirmed"
        || value === "CONFIRMED";
}
function gateHasLedger(gate, ledgers) {
    return (ledgers.gateDecisions ?? []).some((entry) => {
        const row = asRecord(entry);
        return row?.gate === gate && isPassDecision(row.decision ?? row.status);
    });
}
function checkpointHasLedger(checkpoint, ledgers) {
    return (ledgers.checkpoints ?? []).some((entry) => {
        const row = asRecord(entry);
        return row?.name === checkpoint
            && (row.status === "completed" || row.status === "PASS" || row.status === "pass");
    });
}
function hookEventHasLedger(checkpoint, ledgers) {
    return (ledgers.hookEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const decision = row?.decision ?? row?.status;
        return isPassDecision(decision)
            && hasAnyString(entry, [
                checkpoint,
                `hook:${checkpoint}`,
                `checkpoint:${checkpoint}`,
            ]);
    });
}
function hookHasLedger(checkpoint, ledgers) {
    return checkpointHasLedger(checkpoint, ledgers) && hookEventHasLedger(checkpoint, ledgers);
}
function dispatchHasLedger(role, dispatchRef, ledgers) {
    return (ledgers.protocolEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const eventId = row?.event_id;
        return row?.kind === "DISPATCH_REQUEST"
            && row.status === "completed"
            && row.dispatchMode === "real"
            && (typeof eventId !== "string" || !eventId.endsWith("-wait-agent-completed"))
            && hasAnyString(row, dispatchRefTokens(role, dispatchRef));
    });
}
function waitAgentHasLedger(role, dispatchRef, ledgers) {
    return (ledgers.protocolEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const payload = asRecord(row?.payload);
        const eventId = row?.event_id;
        return row?.kind === "DISPATCH_REQUEST"
            && row.status === "completed"
            && row.dispatchMode === "real"
            && typeof eventId === "string"
            && eventId.endsWith("-wait-agent-completed")
            && payload?.event === "WAIT_AGENT_COMPLETED"
            && payload.capability === "wait_agent"
            && hasAnyString(row, [
                ...dispatchRefTokens(role, dispatchRef),
                `wait_agent:${role}`,
            ]);
    });
}
function agentHasLedger(role, dispatchRef, ledgers) {
    return dispatchHasLedger(role, dispatchRef, ledgers) && waitAgentHasLedger(role, dispatchRef, ledgers);
}
function missingAgentLedger(role, dispatchRef, ledgers) {
    const missing = [];
    if (!dispatchHasLedger(role, dispatchRef, ledgers)) {
        missing.push(`ledger:dispatch:${role}`);
    }
    if (!waitAgentHasLedger(role, dispatchRef, ledgers)) {
        missing.push(`ledger:wait_agent:${role}`);
    }
    return missing;
}
/*
 * The tokens below intentionally require separate persisted facts:
 * DISPATCH_REQUEST completed proves a dispatch result existed, while
 * WAIT_AGENT_COMPLETED proves the parent actually waited for that dispatch.
 */
function dispatchRefTokens(role, dispatchRef) {
    const normalizedRef = dispatchRef.startsWith("dispatch:")
        ? dispatchRef.slice("dispatch:".length)
        : dispatchRef;
    return [
        role,
        dispatchRef,
        normalizedRef,
        `dispatch:${role}`,
    ];
}
export function validatePipelineLedgerEvidence(artifact, ledgers) {
    const missing_evidence = [];
    for (const gate of artifact.gates.filter((entry) => entry.status === "PASS")) {
        if (!gateHasLedger(gate.gate, ledgers)) {
            missing_evidence.push(`ledger:gate:${gate.gate}`);
        }
    }
    for (const hook of artifact.hooks.filter((entry) => entry.status === "PASS")) {
        if (!hookHasLedger(hook.checkpoint, ledgers)) {
            missing_evidence.push(`ledger:hook:${hook.checkpoint}`);
        }
    }
    for (const agent of artifact.agents.filter((entry) => entry.status === "PASS")) {
        if (!agentHasLedger(agent.role, agent.dispatch_ref, ledgers)) {
            missing_evidence.push(...missingAgentLedger(agent.role, agent.dispatch_ref, ledgers));
        }
    }
    return {
        status: missing_evidence.length === 0 ? "PASS" : "BLOCKED",
        missing_evidence,
    };
}
