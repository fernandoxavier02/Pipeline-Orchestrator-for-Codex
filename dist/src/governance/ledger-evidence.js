import { ledgerEntryIntegrityVerified } from "../security/ledger-integrity.js";
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
const IDENTITY_KEY_ALIASES = new Map([
    ["run_id", "run"],
    ["runId", "run"],
    ["session_id", "session"],
    ["sessionId", "session"],
    ["trace_id", "trace"],
    ["traceId", "trace"],
    ["workflow_id", "workflow"],
    ["workflowId", "workflow"],
]);
function addIdentityValue(context, key, value) {
    const canonical = IDENTITY_KEY_ALIASES.get(key);
    if (!canonical || typeof value !== "string" || value.length === 0)
        return;
    const values = context.get(canonical) ?? new Set();
    values.add(value);
    context.set(canonical, values);
}
function collectDirectArtifactIdentity(artifact) {
    const context = new Map();
    const record = artifact;
    for (const key of IDENTITY_KEY_ALIASES.keys()) {
        addIdentityValue(context, key, record[key]);
    }
    const strongContext = new Map();
    for (const key of ["run", "session", "trace"]) {
        const values = context.get(key);
        if (values)
            strongContext.set(key, values);
    }
    return strongContext.size > 0 ? strongContext : context;
}
function collectLedgerIdentity(value, depth = 0, context = new Map()) {
    if (depth > 8 || value === undefined || value === null)
        return context;
    if (Array.isArray(value)) {
        for (const entry of value)
            collectLedgerIdentity(entry, depth + 1, context);
        return context;
    }
    if (typeof value !== "object")
        return context;
    for (const [key, entry] of Object.entries(value)) {
        addIdentityValue(context, key, entry);
        collectLedgerIdentity(entry, depth + 1, context);
    }
    return context;
}
function ledgerMatchesArtifactIdentity(entry, expectedIdentity) {
    if (expectedIdentity.size === 0)
        return true;
    const actualIdentity = collectLedgerIdentity(entry);
    for (const [dimension, expectedValues] of expectedIdentity.entries()) {
        const actualValues = actualIdentity.get(dimension);
        if (!actualValues)
            return false;
        for (const expected of expectedValues) {
            if (!actualValues.has(expected))
                return false;
        }
        for (const actual of actualValues) {
            if (!expectedValues.has(actual))
                return false;
        }
    }
    return true;
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
function gateHasLedger(gate, ledgers, expectedIdentity) {
    return (ledgers.gateDecisions ?? []).some((entry) => {
        const row = asRecord(entry);
        return ledgerEntryIntegrityVerified(row)
            && ledgerMatchesArtifactIdentity(row, expectedIdentity)
            && row?.gate === gate
            && isPassDecision(row.decision ?? row.status);
    });
}
function checkpointHasLedger(checkpoint, ledgers, expectedIdentity) {
    return (ledgers.checkpoints ?? []).some((entry) => {
        const row = asRecord(entry);
        return ledgerEntryIntegrityVerified(row)
            && ledgerMatchesArtifactIdentity(row, expectedIdentity)
            && row?.name === checkpoint
            && (row.status === "completed" || row.status === "PASS" || row.status === "pass");
    });
}
function hookEventHasLedger(checkpoint, ledgers, expectedIdentity) {
    return (ledgers.hookEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const decision = row?.decision ?? row?.status;
        return ledgerEntryIntegrityVerified(row)
            && ledgerMatchesArtifactIdentity(row, expectedIdentity)
            && isPassDecision(decision)
            && hasAnyString(entry, [
                checkpoint,
                `hook:${checkpoint}`,
                `checkpoint:${checkpoint}`,
            ]);
    });
}
function hookHasLedger(checkpoint, ledgers, expectedIdentity) {
    return checkpointHasLedger(checkpoint, ledgers, expectedIdentity)
        && hookEventHasLedger(checkpoint, ledgers, expectedIdentity);
}
function normalizeDispatchRef(dispatchRef) {
    return dispatchRef.startsWith("dispatch:")
        ? dispatchRef.slice("dispatch:".length)
        : dispatchRef;
}
function payloadMatchesAgentDispatch(row, role, dispatchRef) {
    const payload = asRecord(row?.payload);
    return payload?.dispatchId === normalizeDispatchRef(dispatchRef)
        && payload.targetName === role
        && payload.targetKind === "agent";
}
function dispatchHasLedger(role, dispatchRef, ledgers, expectedIdentity) {
    return (ledgers.protocolEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const eventId = row?.event_id;
        return ledgerEntryIntegrityVerified(row)
            && ledgerMatchesArtifactIdentity(row, expectedIdentity)
            && row?.kind === "DISPATCH_REQUEST"
            && row.status === "completed"
            && row.dispatchMode === "real"
            && (typeof eventId !== "string" || !eventId.endsWith("-wait-agent-completed"))
            && payloadMatchesAgentDispatch(row, role, dispatchRef);
    });
}
function waitAgentHasLedger(role, dispatchRef, ledgers, expectedIdentity) {
    return (ledgers.protocolEvents ?? []).some((entry) => {
        const row = asRecord(entry);
        const payload = asRecord(row?.payload);
        const eventId = row?.event_id;
        return ledgerEntryIntegrityVerified(row)
            && ledgerMatchesArtifactIdentity(row, expectedIdentity)
            && row?.kind === "DISPATCH_REQUEST"
            && row.status === "completed"
            && row.dispatchMode === "real"
            && typeof eventId === "string"
            && eventId.endsWith("-wait-agent-completed")
            && payload?.event === "WAIT_AGENT_COMPLETED"
            && payload.capability === "wait_agent"
            && payloadMatchesAgentDispatch(row, role, dispatchRef);
    });
}
function agentHasLedger(role, dispatchRef, ledgers, expectedIdentity) {
    return dispatchHasLedger(role, dispatchRef, ledgers, expectedIdentity)
        && waitAgentHasLedger(role, dispatchRef, ledgers, expectedIdentity);
}
function expectedBatchEvidenceRef(batchName, step) {
    return `batch:${batchName}:${step}`;
}
function batchStepHasLedger(batchName, step, stepArtifact, ledgers, expectedIdentity) {
    const artifact = asRecord(stepArtifact);
    const evidenceRef = artifact?.evidence_ref;
    if (evidenceRef !== expectedBatchEvidenceRef(batchName, step))
        return false;
    const expectedGate = `BATCH_LOOP:${batchName}:${step}`;
    return (ledgers.gateDecisions ?? []).some((entry) => {
        const row = asRecord(entry);
        if (!ledgerEntryIntegrityVerified(row)
            || !ledgerMatchesArtifactIdentity(row, expectedIdentity)
            || row?.gate !== expectedGate
            || row.evidence_ref !== evidenceRef
            || !isPassDecision(row.decision ?? row.status)) {
            return false;
        }
        if (step !== "fix_loop")
            return true;
        const openFindings = row.open_findings;
        const attempts = row.attempts;
        return typeof openFindings === "number"
            && Number.isInteger(openFindings)
            && openFindings === 0
            && typeof attempts === "number"
            && Number.isInteger(attempts)
            && attempts >= 0
            && attempts <= 3;
    });
}
function missingBatchLedger(batch, index, ledgers, expectedIdentity) {
    const row = asRecord(batch);
    const batchName = typeof row?.name === "string" && row.name.trim().length > 0
        ? row.name.trim()
        : `batch-${index + 1}`;
    const missing = [];
    for (const step of ["checkpoint", "adversarial_review", "fix_loop"]) {
        if (!batchStepHasLedger(batchName, step, row?.[step], ledgers, expectedIdentity)) {
            missing.push(`ledger:batch:${batchName}:${step}`);
        }
    }
    return missing;
}
function missingAgentLedger(role, dispatchRef, ledgers, expectedIdentity) {
    const missing = [];
    if (!dispatchHasLedger(role, dispatchRef, ledgers, expectedIdentity)) {
        missing.push(`ledger:dispatch:${role}`);
    }
    if (!waitAgentHasLedger(role, dispatchRef, ledgers, expectedIdentity)) {
        missing.push(`ledger:wait_agent:${role}`);
    }
    return missing;
}
export function validatePipelineLedgerEvidence(artifact, ledgers) {
    const missing_evidence = [];
    const expectedIdentity = collectDirectArtifactIdentity(artifact);
    for (const gate of artifact.gates.filter((entry) => entry.status === "PASS")) {
        if (!gateHasLedger(gate.gate, ledgers, expectedIdentity)) {
            missing_evidence.push(`ledger:gate:${gate.gate}`);
        }
    }
    for (const hook of artifact.hooks.filter((entry) => entry.status === "PASS")) {
        if (!hookHasLedger(hook.checkpoint, ledgers, expectedIdentity)) {
            missing_evidence.push(`ledger:hook:${hook.checkpoint}`);
        }
    }
    for (const agent of artifact.agents.filter((entry) => entry.status === "PASS")) {
        if (!agentHasLedger(agent.role, agent.dispatch_ref, ledgers, expectedIdentity)) {
            missing_evidence.push(...missingAgentLedger(agent.role, agent.dispatch_ref, ledgers, expectedIdentity));
        }
    }
    for (const [index, batch] of artifact.batches.entries()) {
        if (batch.status === "PASS") {
            missing_evidence.push(...missingBatchLedger(batch, index, ledgers, expectedIdentity));
        }
    }
    return {
        status: missing_evidence.length === 0 ? "PASS" : "BLOCKED",
        missing_evidence,
    };
}
