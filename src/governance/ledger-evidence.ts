import type { PipelineGovernanceArtifact } from "./pipeline-contract.js";

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

function gateHasLedger(gate: string, ledgers: PipelineLedgerEvidenceInput) {
  return (ledgers.gateDecisions ?? []).some((entry) => {
    const row = asRecord(entry);
    return row?.gate === gate && isPassDecision(row.decision ?? row.status);
  });
}

function checkpointHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput) {
  return (ledgers.checkpoints ?? []).some((entry) => {
    const row = asRecord(entry);
    return row?.name === checkpoint
      && (row.status === "completed" || row.status === "PASS" || row.status === "pass");
  });
}

function hookEventHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput) {
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

function hookHasLedger(checkpoint: string, ledgers: PipelineLedgerEvidenceInput) {
  return checkpointHasLedger(checkpoint, ledgers) && hookEventHasLedger(checkpoint, ledgers);
}

function dispatchHasLedger(role: string, dispatchRef: string, ledgers: PipelineLedgerEvidenceInput) {
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

function waitAgentHasLedger(role: string, dispatchRef: string, ledgers: PipelineLedgerEvidenceInput) {
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

function agentHasLedger(role: string, dispatchRef: string, ledgers: PipelineLedgerEvidenceInput) {
  return dispatchHasLedger(role, dispatchRef, ledgers) && waitAgentHasLedger(role, dispatchRef, ledgers);
}

function missingAgentLedger(role: string, dispatchRef: string, ledgers: PipelineLedgerEvidenceInput) {
  const missing: string[] = [];
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
function dispatchRefTokens(role: string, dispatchRef: string) {
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

export function validatePipelineLedgerEvidence(
  artifact: PipelineGovernanceArtifact,
  ledgers: PipelineLedgerEvidenceInput,
) {
  const missing_evidence: string[] = [];

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
    status: missing_evidence.length === 0 ? "PASS" as const : "BLOCKED" as const,
    missing_evidence,
  };
}
