import type { PipelineGovernanceArtifact } from "./pipeline-contract.js";
import { ledgerEntryIntegrityVerified } from "../security/ledger-integrity.js";

export interface PipelineLedgerEvidenceInput {
  protocolEvents?: unknown[];
  gateDecisions?: unknown[];
  hookEvents?: unknown[];
  checkpoints?: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
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

type IdentityContext = Map<string, Set<string>>;

function addIdentityValue(context: IdentityContext, key: string, value: unknown) {
  const canonical = IDENTITY_KEY_ALIASES.get(key);
  if (!canonical || typeof value !== "string" || value.length === 0) return;

  const values = context.get(canonical) ?? new Set<string>();
  values.add(value);
  context.set(canonical, values);
}

function collectDirectArtifactIdentity(artifact: PipelineGovernanceArtifact): IdentityContext {
  const context: IdentityContext = new Map();
  const record = artifact as unknown as Record<string, unknown>;
  for (const key of IDENTITY_KEY_ALIASES.keys()) {
    addIdentityValue(context, key, record[key]);
  }

  const strongContext: IdentityContext = new Map();
  for (const key of ["run", "session", "trace"]) {
    const values = context.get(key);
    if (values) strongContext.set(key, values);
  }
  return strongContext.size > 0 ? strongContext : context;
}

function collectLedgerIdentity(value: unknown, depth = 0, context: IdentityContext = new Map()): IdentityContext {
  if (depth > 8 || value === undefined || value === null) return context;
  if (Array.isArray(value)) {
    for (const entry of value) collectLedgerIdentity(entry, depth + 1, context);
    return context;
  }
  if (typeof value !== "object") return context;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    addIdentityValue(context, key, entry);
    collectLedgerIdentity(entry, depth + 1, context);
  }
  return context;
}

function ledgerMatchesArtifactIdentity(entry: unknown, expectedIdentity: IdentityContext) {
  if (expectedIdentity.size === 0) return true;
  const actualIdentity = collectLedgerIdentity(entry);
  for (const [dimension, expectedValues] of expectedIdentity.entries()) {
    const actualValues = actualIdentity.get(dimension);
    if (!actualValues) return false;
    for (const expected of expectedValues) {
      if (!actualValues.has(expected)) return false;
    }
    for (const actual of actualValues) {
      if (!expectedValues.has(actual)) return false;
    }
  }
  return true;
}

function collectStrings(value: unknown, depth = 0): string[] {
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

function hasString(value: unknown, expected: string) {
  return collectStrings(value).some((candidate) => candidate === expected);
}

function hasAnyString(value: unknown, expected: string[]) {
  return expected.some((entry) => hasString(value, entry));
}

function isPassDecision(value: unknown) {
  return value === "pass"
    || value === "PASS"
    || value === "approved"
    || value === "APPROVED"
    || value === "confirmed"
    || value === "CONFIRMED";
}

function gateHasLedger(gate: string, ledgers: PipelineLedgerEvidenceInput, expectedIdentity: IdentityContext) {
  return (ledgers.gateDecisions ?? []).some((entry) => {
    const row = asRecord(entry);
    return ledgerEntryIntegrityVerified(row)
      && ledgerMatchesArtifactIdentity(row, expectedIdentity)
      && row?.gate === gate
      && isPassDecision(row.decision ?? row.status);
  });
}

function checkpointHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput, expectedIdentity: IdentityContext) {
  return (ledgers.checkpoints ?? []).some((entry) => {
    const row = asRecord(entry);
    return ledgerEntryIntegrityVerified(row)
      && ledgerMatchesArtifactIdentity(row, expectedIdentity)
      && row?.name === checkpoint
      && (row.status === "completed" || row.status === "PASS" || row.status === "pass");
  });
}

function hookEventHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput, expectedIdentity: IdentityContext) {
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

function hookHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput, expectedIdentity: IdentityContext) {
  return checkpointHasLedger(checkpoint, ledgers, expectedIdentity)
    && hookEventHasLedger(checkpoint, ledgers, expectedIdentity);
}

function normalizeDispatchRef(dispatchRef: string) {
  return dispatchRef.startsWith("dispatch:")
    ? dispatchRef.slice("dispatch:".length)
    : dispatchRef;
}

function payloadMatchesAgentDispatch(row: Record<string, unknown> | undefined, role: string, dispatchRef: string) {
  const payload = asRecord(row?.payload);
  return payload?.dispatchId === normalizeDispatchRef(dispatchRef)
    && payload.targetName === role
    && payload.targetKind === "agent";
}

function dispatchHasLedger(
  role: string,
  dispatchRef: string,
  ledgers: PipelineLedgerEvidenceInput,
  expectedIdentity: IdentityContext,
) {
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

function waitAgentHasLedger(
  role: string,
  dispatchRef: string,
  ledgers: PipelineLedgerEvidenceInput,
  expectedIdentity: IdentityContext,
) {
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

function agentHasLedger(
  role: string,
  dispatchRef: string,
  ledgers: PipelineLedgerEvidenceInput,
  expectedIdentity: IdentityContext,
) {
  return dispatchHasLedger(role, dispatchRef, ledgers, expectedIdentity)
    && waitAgentHasLedger(role, dispatchRef, ledgers, expectedIdentity);
}

function missingAgentLedger(
  role: string,
  dispatchRef: string,
  ledgers: PipelineLedgerEvidenceInput,
  expectedIdentity: IdentityContext,
) {
  const missing: string[] = [];
  if (!dispatchHasLedger(role, dispatchRef, ledgers, expectedIdentity)) {
    missing.push(`ledger:dispatch:${role}`);
  }
  if (!waitAgentHasLedger(role, dispatchRef, ledgers, expectedIdentity)) {
    missing.push(`ledger:wait_agent:${role}`);
  }
  return missing;
}

export function validatePipelineLedgerEvidence(
  artifact: PipelineGovernanceArtifact,
  ledgers: PipelineLedgerEvidenceInput,
) {
  const missing_evidence: string[] = [];
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

  return {
    status: missing_evidence.length === 0 ? "PASS" as const : "BLOCKED" as const,
    missing_evidence,
  };
}
