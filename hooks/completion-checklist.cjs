#!/usr/bin/env node
/**
 * Hook: completion-checklist.cjs (Codex port)
 * Event: Stop
 *
 * When the agent attempts to stop, verifies that minimum requirements
 * were met according to pipeline orchestrator rules:
 *   - ORCHESTRATOR_DECISION emitted
 *   - Build/tests passed
 *   - Pipeline phases completed (if /pipeline-orchestrator-for-codex:pipeline was invoked)
 *
 * Generic — works with any project. Project-specific commands should
 * be configured in .codex/pipeline.local.md
 *
 * Ported from Claude Code pipeline-orchestrator v3.2.0
 * Adapted: .kiro/ paths kept (project-level), .codex/ for plugin config
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordHookEvent } = require('./hook-events.cjs');
const {
  ledgerEntryIntegrityVerified,
  resolveSentinelIntegrityHmacKey,
} = require('./ledger-integrity.cjs');

const REQUIRED_PIPELINE_GATES = [
  'CAPABILITY_GATE',
  'INTAKE_GATE',
  'SCOPE_GATE',
  'EVIDENCE_GATE',
  'ADVERSARIAL_GATE',
  'FINAL_VERDICT_GATE',
];

const CHECKPOINT_PHASES = [
  'intake',
  'planning',
  'agent_dispatch',
  'artifact_collection',
  'adversarial_review',
  'final_verdict',
];

const REQUIRED_PIPELINE_HOOKS = CHECKPOINT_PHASES.flatMap((phase) => [
  `${phase}:before`,
  `${phase}:after`,
]);

const REQUIRED_PIPELINE_CAPABILITIES = [
  'spawn_agent',
  'wait_agent',
  'subagent_artifact_collection',
  'gate_recording',
  'hook_checkpoint_recording',
  'structured_final_state',
];

const REAL_AGENT_BLOCKABLE_CAPABILITIES = [
  'subagent_artifact_collection',
  'gate_recording',
  'hook_checkpoint_recording',
];

const GOVERNANCE_ARTIFACT_FILES = [
  'pipeline-governance-artifact.json',
  'governance-artifact.json',
  'final-governance-artifact.json',
];

const HMAC_SHA256_HEX_SIGNATURE = /^[0-9a-f]{64}$/iu;

function parsePayload(raw) {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return undefined;
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readJsonlIfExists(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function readCheckpointLedger(stateDir) {
  const checkpointDir = path.join(stateDir, 'checkpoints');
  try {
    if (!fs.existsSync(checkpointDir)) return [];
    return fs.readdirSync(checkpointDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .flatMap((entry) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(checkpointDir, entry.name), 'utf8'))];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function sentinelIntegrityVerified(stateDir) {
  const key = resolveSentinelIntegrityHmacKey();
  if (!key) return false;

  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  const integrity = sentinel && typeof sentinel === 'object' ? sentinel._integrity : undefined;
  if (
    !integrity
    || integrity.algorithm !== 'hmac-sha256'
    || typeof integrity.signature !== 'string'
    || !HMAC_SHA256_HEX_SIGNATURE.test(integrity.signature)
  ) {
    return false;
  }

  const unsignedState = { ...sentinel };
  delete unsignedState._integrity;
  const expected = crypto.createHmac('sha256', key).update(canonicalize(unsignedState)).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(integrity.signature, 'hex');
  return actualBytes.length > 0
    && expectedBytes.length === actualBytes.length
    && crypto.timingSafeEqual(expectedBytes, actualBytes);
}

function collectText(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => collectText(entry, depth + 1)).join('\n');
  if (typeof value === 'object') {
    return Object.values(value).map((entry) => collectText(entry, depth + 1)).join('\n');
  }
  return '';
}

function readTranscriptText(payload) {
  const transcriptPath = typeof payload.transcript_path === 'string'
    ? payload.transcript_path
    : typeof payload.transcriptPath === 'string'
      ? payload.transcriptPath
      : undefined;
  if (!transcriptPath) return '';
  try {
    const resolved = path.resolve(transcriptPath);
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 2_000_000) return '';
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return '';
  }
}

function pipelineWasExplicitlyRequested(payload, rawText, stateDir) {
  if (/\/pipeline-orchestrator(?:-for-codex)?:pipeline\b/iu.test(rawText)) return true;
  if (/\[(?:[@$])?pipeline(?:\s|-)?orchestrator(?:\s|-)?for(?:\s|-)?codex\]\((?:plugin|app):\/\/pipeline-orchestrator-for-codex(?=[)@/?#])[^)]*\)/iu.test(rawText)) return true;
  if (/[@$]pipeline(?:\s|-)?orchestrator(?:\s|-)?for(?:\s|-)?codex\b/iu.test(rawText)) return true;
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  if (sentinel && sentinel.pipelineActive === true) return true;
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  return !!(
    session
    && (
      session.pipeline_requested === true
      || typeof session.run_id === 'string'
      || typeof session.sessionId === 'string'
      || typeof session.currentPhase === 'string'
    )
  );
}

function pipelineStateIsActive(stateDir) {
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  if (sentinel && sentinel.pipelineActive === true) return true;
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  return !!(session && session.pipelineActive === true);
}

function outputAttemptsPipelineCompletion(rawText) {
  return /\bPIPELINE COMPLETE\b/iu.test(rawText)
    || /["']?pipeline_valid["']?\s*[:=]\s*true/iu.test(rawText)
    || /\b(?:PIPELINE[\s_-]*STATUS|FINAL[\s_-]*(?:REVIEW|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|REPORT|VERDICT|DECISION)|FINAL[\s_-]*ADVERSARIAL|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|VERDICT|GO\/NO-GO|REVIEW[\s_-]*VERDICT)(?:\s*(?::|=|-|\bis\b|\best[áa]\b)\s*|\s+)(?:GO|NO-GO|CONDITIONAL|PASS|CLEAN|APPROVED)\b/iu.test(rawText)
    || /\bno\s+P0\/P1\/P2\s+(?:remain|remaining)\b/iu.test(rawText)
    || /blocked-no-agent-runtime/iu.test(rawText);
}

function outputClaimsSuccessfulPipelineCompletion(rawText) {
  return /["']?pipeline_valid["']?\s*[:=]\s*true/iu.test(rawText)
    || /\b(?:PIPELINE[\s_-]*STATUS|FINAL[\s_-]*(?:REVIEW|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|REPORT|VERDICT|DECISION)|FINAL[\s_-]*ADVERSARIAL|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|VERDICT|GO\/NO-GO|REVIEW[\s_-]*VERDICT)(?:\s*(?::|=|-|\bis\b|\best[áa]\b)\s*|\s+)(?:GO|PASS|CLEAN|APPROVED|CONDITIONAL)\b/iu.test(rawText)
    || /\bno blocking issues remain\b/iu.test(rawText)
    || /\bno\s+P0\/P1\/P2\s+(?:remain|remaining)\b/iu.test(rawText)
    || /\bsem\s+P0\/P1\/P2\b/iu.test(rawText);
}

function payloadContainsGovernanceArtifact(payload, stateDir) {
  return !!findGovernanceArtifact(payload, stateDir);
}

function arrayContainsPass(items, key, id) {
  return Array.isArray(items)
    && items.some((item) => item && item[key] === id && item.status === 'PASS');
}

function collectLedgerStrings(value, depth = 0) {
  if (depth > 8 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((entry) => collectLedgerStrings(entry, depth + 1));
  if (typeof value === 'object') return Object.values(value).flatMap((entry) => collectLedgerStrings(entry, depth + 1));
  return [];
}

const STRONG_RUN_ID_KEYS = new Set([
  'run_id',
  'runId',
  'session_id',
  'sessionId',
  'trace_id',
  'traceId',
]);

const WEAK_RUN_ID_KEYS = new Set([
  'workflow_id',
  'workflowId',
]);

const RUN_ID_KEYS = new Set([
  ...STRONG_RUN_ID_KEYS,
  ...WEAK_RUN_ID_KEYS,
]);

const IDENTITY_KEY_ALIASES = new Map([
  ['run_id', 'run'],
  ['runId', 'run'],
  ['session_id', 'session'],
  ['sessionId', 'session'],
  ['trace_id', 'trace'],
  ['traceId', 'trace'],
  ['workflow_id', 'workflow'],
  ['workflowId', 'workflow'],
]);

function canonicalIdentityKey(key) {
  return IDENTITY_KEY_ALIASES.get(key) ?? key;
}

const PRIMARY_STRONG_IDENTITY_DIMENSIONS = new Set(['run', 'session']);

function collectIdentityMap(value, depth = 0, keys = RUN_ID_KEYS, result = new Map()) {
  if (depth > 8 || value === undefined || value === null) return result;
  if (Array.isArray(value)) {
    for (const entry of value) collectIdentityMap(entry, depth + 1, keys, result);
    return result;
  }
  if (typeof value !== 'object') return result;

  for (const [key, entry] of Object.entries(value)) {
    collectIdentityMap(entry, depth + 1, keys, result);
    if (!keys.has(key) || (typeof entry !== 'string' && typeof entry !== 'number')) continue;
    const normalized = String(entry).trim();
    if (normalized.length === 0) continue;
    const canonicalKey = canonicalIdentityKey(key);
    if (!result.has(canonicalKey)) result.set(canonicalKey, new Set());
    result.get(canonicalKey).add(normalized);
  }
  return result;
}

function collectDirectIdentityMap(value, keys = RUN_ID_KEYS) {
  const result = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.has(key) || (typeof entry !== 'string' && typeof entry !== 'number')) continue;
    const normalized = String(entry).trim();
    if (normalized.length === 0) continue;
    const canonicalKey = canonicalIdentityKey(key);
    if (!result.has(canonicalKey)) result.set(canonicalKey, new Set());
    result.get(canonicalKey).add(normalized);
  }
  return result;
}

function hasConflictingStrongIdentity(artifact, stateDir) {
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  const activeMap = mergeIdentityMaps(
    collectDirectIdentityMap(sentinel, STRONG_RUN_ID_KEYS),
    collectDirectIdentityMap(session, STRONG_RUN_ID_KEYS),
  );
  const artifactMap = collectIdentityMap(artifact, 0, STRONG_RUN_ID_KEYS);

  for (const [key, activeValues] of activeMap.entries()) {
    const artifactValues = artifactMap.get(key);
    if (!artifactValues || artifactValues.size === 0) continue;
    if ([...artifactValues].some((value) => !activeValues.has(value))) {
      return true;
    }
  }
  return false;
}

function valuesFromIdentityMap(identityMap) {
  return [...new Set([...identityMap.values()].flatMap((values) => [...values]))];
}

function identityMapsConflict(leftMap, rightMap) {
  for (const [key, leftValues] of leftMap.entries()) {
    const rightValues = rightMap.get(key);
    if (!rightValues || rightValues.size === 0) continue;
    if (leftValues.size !== rightValues.size) return true;
    if ([...leftValues].some((value) => !rightValues.has(value))) return true;
  }
  return false;
}

function identityMapsHaveSameKeys(leftMap, rightMap) {
  if (leftMap.size !== rightMap.size) return false;
  return [...leftMap.keys()].every((key) => {
    const rightValues = rightMap.get(key);
    return rightValues && rightValues.size > 0;
  });
}

function mergeIdentityMaps(...identityMaps) {
  const result = new Map();
  for (const identityMap of identityMaps) {
    for (const [key, values] of identityMap.entries()) {
      if (!result.has(key)) result.set(key, new Set());
      for (const value of values) result.get(key).add(value);
    }
  }
  return result;
}

function entryIdentityMapForContext(entry, identityContext) {
  if (identityContext.keys === WEAK_RUN_ID_KEYS) {
    return collectIdentityMap(entry, 0, RUN_ID_KEYS);
  }
  return collectIdentityMap(entry, 0, identityContext.keys);
}

function entryHasUnprovenPrimaryIdentity(entryMap, identityContext) {
  for (const key of PRIMARY_STRONG_IDENTITY_DIMENSIONS) {
    const values = entryMap.get(key);
    if (values && values.size > 0 && !identityContext.map.has(key)) return true;
  }
  return false;
}

function identityContextHasPrimaryStrongIdentity(identityContext) {
  if (!identityContext || identityContext.conflict) return false;
  for (const key of PRIMARY_STRONG_IDENTITY_DIMENSIONS) {
    const values = identityContext.map.get(key);
    if (values && values.size > 0) return true;
  }
  return false;
}

function activeRunIdentityContext(stateDir) {
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  const sentinelStrongMap = collectDirectIdentityMap(sentinel, STRONG_RUN_ID_KEYS);
  const sentinelStrongIds = valuesFromIdentityMap(sentinelStrongMap);
  const sessionStrongMap = collectDirectIdentityMap(session, STRONG_RUN_ID_KEYS);
  const sessionStrongIds = valuesFromIdentityMap(sessionStrongMap);
  if (sentinelStrongIds.length > 0 && sessionStrongIds.length > 0) {
    if (
      !identityMapsHaveSameKeys(sentinelStrongMap, sessionStrongMap)
      || identityMapsConflict(sentinelStrongMap, sessionStrongMap)
    ) {
      return {
        ids: [],
        map: new Map(),
        keys: STRONG_RUN_ID_KEYS,
        conflict: true,
      };
    }
    const strongMap = mergeIdentityMaps(sentinelStrongMap, sessionStrongMap);
    return {
      ids: valuesFromIdentityMap(strongMap),
      map: strongMap,
      keys: STRONG_RUN_ID_KEYS,
    };
  }
  if (sentinelStrongIds.length > 0) {
    return {
      ids: sentinelStrongIds,
      map: sentinelStrongMap,
      keys: STRONG_RUN_ID_KEYS,
    };
  }

  if (sessionStrongIds.length > 0) {
    return {
      ids: sessionStrongIds,
      map: sessionStrongMap,
      keys: STRONG_RUN_ID_KEYS,
    };
  }

  const sentinelWeakMap = collectDirectIdentityMap(sentinel, WEAK_RUN_ID_KEYS);
  const sentinelWeakIds = valuesFromIdentityMap(sentinelWeakMap);
  if (sentinelWeakIds.length > 0) {
    return {
      ids: sentinelWeakIds,
      map: sentinelWeakMap,
      keys: WEAK_RUN_ID_KEYS,
    };
  }

  const sessionWeakMap = collectDirectIdentityMap(session, WEAK_RUN_ID_KEYS);
  return {
    ids: valuesFromIdentityMap(sessionWeakMap),
    map: sessionWeakMap,
    keys: WEAK_RUN_ID_KEYS,
  };
}

function entryMatchesActiveRunIdentity(entry, identityContext) {
  if (!identityContext) return true;
  if (identityContext.conflict) return false;
  if (identityContext.ids.length === 0) return true;

  const entryMap = entryIdentityMapForContext(entry, identityContext);
  if (entryHasUnprovenPrimaryIdentity(entryMap, identityContext)) return false;
  for (const [key, activeValues] of identityContext.map.entries()) {
    const entryValues = entryMap.get(key);
    if (!entryValues || entryValues.size === 0) return false;
    if ([...entryValues].some((value) => !activeValues.has(value))) {
      return false;
    }
  }

  return true;
}

function entryHasActiveRunIdentityConflict(entry, identityContext) {
  if (!identityContext) return false;
  if (identityContext.conflict) return true;
  if (identityContext.ids.length === 0) return false;

  const entryMap = entryIdentityMapForContext(entry, identityContext);
  if (entryHasUnprovenPrimaryIdentity(entryMap, identityContext)) return true;
  for (const [key, activeValues] of identityContext.map.entries()) {
    const entryValues = entryMap.get(key);
    if (!entryValues || entryValues.size === 0) continue;
    if ([...entryValues].some((value) => !activeValues.has(value))) {
      return true;
    }
  }

  return false;
}

function collectRunIdentities(value, depth = 0, keys = RUN_ID_KEYS) {
  if (depth > 8 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectRunIdentities(entry, depth + 1, keys));
  if (typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const nested = collectRunIdentities(entry, depth + 1, keys);
    if (!keys.has(key) || (typeof entry !== 'string' && typeof entry !== 'number')) {
      return nested;
    }
    const normalized = String(entry).trim();
    return normalized.length > 0 ? [normalized, ...nested] : nested;
  });
}

function activeRunIdentities(stateDir) {
  return activeRunIdentityContext(stateDir).ids;
}

function isPassPipelineArtifact(artifact) {
  return !!(
    artifact
    && typeof artifact === 'object'
    && (
      artifact.pipeline_valid === true
      || artifact.status === 'PASS'
      || (artifact.final_verdict && artifact.final_verdict.status === 'PASS')
    )
  );
}

function artifactRequiresCurrentRunIdentity(artifact) {
  return isPassPipelineArtifact(artifact) || isStructuredBlockedPipelineArtifact(artifact);
}

function artifactMatchesActiveRun(artifact, ledgers, stateDir, options = {}) {
  const identityContext = activeRunIdentityContext(stateDir);
  if (identityContext.conflict) return false;
  if (identityContext.ids.length > 0 && !identityContextHasPrimaryStrongIdentity(identityContext)) return false;
  if (identityContext.ids.length === 0) return !isPassPipelineArtifact(artifact);
  if (hasConflictingStrongIdentity(artifact, stateDir)) return false;
  if (!entryMatchesActiveRunIdentity(artifact, identityContext)) return false;
  return true;
}

function ledgerHasAnyString(value, expected) {
  const strings = collectLedgerStrings(value);
  return expected.some((entry) => strings.includes(entry));
}

function ledgerGatePassed(gate, ledgers, identityContext) {
  return ledgers.gateDecisions.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && entry.gate === gate
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    && entryMatchesActiveRunIdentity(entry, identityContext)
  ));
}

function ledgerGateHasIdentityConflict(gate, ledgers, identityContext) {
  return ledgers.gateDecisions.some((entry) => (
    entry
    && entry.gate === gate
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    && entryHasActiveRunIdentityConflict(entry, identityContext)
  ));
}

function ledgerCheckpointPassed(checkpoint, ledgers, identityContext) {
  return ledgers.checkpoints.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && entry.name === checkpoint
    && ['completed', 'PASS', 'pass'].includes(entry.status)
    && entryMatchesActiveRunIdentity(entry, identityContext)
  ));
}

function ledgerCheckpointHasIdentityConflict(checkpoint, ledgers, identityContext) {
  return ledgers.checkpoints.some((entry) => (
    entry
    && entry.name === checkpoint
    && ['completed', 'PASS', 'pass'].includes(entry.status)
    && entryHasActiveRunIdentityConflict(entry, identityContext)
  ));
}

function ledgerHookEventPassed(checkpoint, ledgers, identityContext) {
  return ledgers.hookEvents.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    && ledgerHasAnyString(entry, [
      checkpoint,
      `hook:${checkpoint}`,
      `checkpoint:${checkpoint}`,
    ])
    && entryMatchesActiveRunIdentity(entry, identityContext)
  ));
}

function ledgerHookEventHasIdentityConflict(checkpoint, ledgers, identityContext) {
  return ledgers.hookEvents.some((entry) => (
    entry
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    && ledgerHasAnyString(entry, [
      checkpoint,
      `hook:${checkpoint}`,
      `checkpoint:${checkpoint}`,
    ])
    && entryHasActiveRunIdentityConflict(entry, identityContext)
  ));
}

function ledgerHookPassed(checkpoint, ledgers, identityContext) {
  return ledgerCheckpointPassed(checkpoint, ledgers, identityContext)
    && ledgerHookEventPassed(checkpoint, ledgers, identityContext);
}

function ledgerHookHasIdentityConflict(checkpoint, ledgers, identityContext) {
  return ledgerCheckpointHasIdentityConflict(checkpoint, ledgers, identityContext)
    || ledgerHookEventHasIdentityConflict(checkpoint, ledgers, identityContext);
}

function dispatchRefTokens(role, dispatchRef) {
  const normalizedRef = typeof dispatchRef === 'string' && dispatchRef.startsWith('dispatch:')
    ? dispatchRef.slice('dispatch:'.length)
    : dispatchRef;
  return [role, dispatchRef, normalizedRef, `dispatch:${role}`].filter(Boolean);
}

function normalizedDispatchRef(dispatchRef) {
  return typeof dispatchRef === 'string' && dispatchRef.startsWith('dispatch:')
    ? dispatchRef.slice('dispatch:'.length)
    : dispatchRef;
}

function payloadMatchesAgentDispatch(entry, agent) {
  const payload = entry && entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
    ? entry.payload
    : undefined;
  return payload
    && payload.dispatchId === normalizedDispatchRef(agent.dispatch_ref)
    && payload.targetName === agent.role
    && payload.targetKind === 'agent';
}

function ledgerDispatchCompleted(agent, ledgers, identityContext) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && (typeof entry.event_id !== 'string' || !entry.event_id.endsWith('-wait-agent-completed'))
    && payloadMatchesAgentDispatch(entry, agent)
    && entryMatchesActiveRunIdentity(entry, identityContext)
  ));
}

function ledgerDispatchHasIdentityConflict(agent, ledgers, identityContext) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && (typeof entry.event_id !== 'string' || !entry.event_id.endsWith('-wait-agent-completed'))
    && payloadMatchesAgentDispatch(entry, agent)
    && entryHasActiveRunIdentityConflict(entry, identityContext)
  ));
}

function ledgerWaitAgentCompleted(agent, ledgers, identityContext) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && typeof entry.event_id === 'string'
    && entry.event_id.endsWith('-wait-agent-completed')
    && entry.payload
    && entry.payload.event === 'WAIT_AGENT_COMPLETED'
    && entry.payload.capability === 'wait_agent'
    && payloadMatchesAgentDispatch(entry, agent)
    && entryMatchesActiveRunIdentity(entry, identityContext)
  ));
}

function ledgerWaitAgentHasIdentityConflict(agent, ledgers, identityContext) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && typeof entry.event_id === 'string'
    && entry.event_id.endsWith('-wait-agent-completed')
    && entry.payload
    && entry.payload.event === 'WAIT_AGENT_COMPLETED'
    && entry.payload.capability === 'wait_agent'
    && payloadMatchesAgentDispatch(entry, agent)
    && entryHasActiveRunIdentityConflict(entry, identityContext)
  ));
}

function appendIdentityConflict(missing) {
  if (!missing.includes('current_run_identity')) missing.unshift('current_run_identity');
}

function validateLedgerEvidence(artifact, ledgers, identityContext) {
  const missing = [];
  for (const gate of Array.isArray(artifact.gates) ? artifact.gates : []) {
    if (gate && gate.status === 'PASS' && !ledgerGatePassed(gate.gate, ledgers, identityContext)) {
      if (ledgerGateHasIdentityConflict(gate.gate, ledgers, identityContext)) appendIdentityConflict(missing);
      missing.push(`ledger:gate:${gate.gate}`);
    }
  }
  for (const hook of Array.isArray(artifact.hooks) ? artifact.hooks : []) {
    if (hook && hook.status === 'PASS' && !ledgerHookPassed(hook.checkpoint, ledgers, identityContext)) {
      if (ledgerHookHasIdentityConflict(hook.checkpoint, ledgers, identityContext)) appendIdentityConflict(missing);
      missing.push(`ledger:hook:${hook.checkpoint}`);
    }
  }
  for (const agent of Array.isArray(artifact.agents) ? artifact.agents : []) {
    if (!agent || agent.status !== 'PASS') continue;
    if (!ledgerDispatchCompleted(agent, ledgers, identityContext)) {
      if (ledgerDispatchHasIdentityConflict(agent, ledgers, identityContext)) appendIdentityConflict(missing);
      missing.push(`ledger:dispatch:${agent.role}`);
    }
    if (!ledgerWaitAgentCompleted(agent, ledgers, identityContext)) {
      if (ledgerWaitAgentHasIdentityConflict(agent, ledgers, identityContext)) appendIdentityConflict(missing);
      missing.push(`ledger:wait_agent:${agent.role}`);
    }
  }
  return missing;
}

function readLedgers(stateDir) {
  return {
    protocolEvents: readJsonlIfExists(path.join(stateDir, 'protocol-events.jsonl')),
    gateDecisions: readJsonlIfExists(path.join(stateDir, 'gate-decisions.jsonl')),
    hookEvents: readJsonlIfExists(path.join(stateDir, 'hook-events.jsonl')),
    checkpoints: readCheckpointLedger(stateDir),
  };
}

function validateGovernanceArtifact(artifact, ledgers = undefined, stateDir = undefined) {
  const missing = [];
  if (!artifact || typeof artifact !== 'object') {
    return {
      ok: false,
      missing: [
        'PipelineGovernanceArtifact',
        ...REQUIRED_PIPELINE_GATES.map((gate) => `gate:${gate}`),
        ...REQUIRED_PIPELINE_HOOKS.map((hook) => `hook:${hook}`),
        'agent:primary_reviewer',
        'agent:adversarial_reviewer',
        'final_verdict:PASS',
      ],
    };
  }
  if (artifact.pipeline_requested !== true) missing.push('pipeline_requested');
  if (artifact.pipeline_valid !== true) missing.push('pipeline_valid');
  if (artifact.runtime_mode !== 'real-agent') missing.push('runtime_mode:real-agent');
  if (artifact.hook_enforcement_mode !== 'blocking') missing.push('hook_enforcement_mode:blocking');
  if (artifact.status !== 'PASS') missing.push('status:PASS');
  if (artifact.manual_fallback_counts_as_pipeline !== false) missing.push('manual_fallback_counts_as_pipeline:false');
  if (!artifact.final_verdict || artifact.final_verdict.status !== 'PASS') missing.push('final_verdict:PASS');

  for (const gate of REQUIRED_PIPELINE_GATES) {
    if (!arrayContainsPass(artifact.gates, 'gate', gate)) missing.push(`gate:${gate}`);
  }

  for (const hook of REQUIRED_PIPELINE_HOOKS) {
    if (!arrayContainsPass(artifact.hooks, 'checkpoint', hook)) missing.push(`hook:${hook}`);
  }

  const agents = Array.isArray(artifact.agents) ? artifact.agents : [];
  for (const role of ['primary_reviewer', 'adversarial_reviewer']) {
    if (!agents.some((agent) => agent && agent.role === role && agent.status === 'PASS' && agent.independent === true)) {
      missing.push(`agent:${role}`);
    }
  }

  if (missing.length === 0 && ledgers) {
    const identityContext = stateDir ? activeRunIdentityContext(stateDir) : undefined;
    missing.push(...validateLedgerEvidence(artifact, ledgers, identityContext));
  }

  return { ok: missing.length === 0, missing };
}

function validatePassArtifactIntegrity(stateDir) {
  return sentinelIntegrityVerified(stateDir) ? [] : ['sentinel_integrity:hmac-sha256'];
}

function isStructuredBlockedPipelineArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return false;
  const gates = Array.isArray(artifact.gates) ? artifact.gates : [];
  const missingCapabilities = Array.isArray(artifact.missing_capabilities)
    ? artifact.missing_capabilities
    : [];
  const hasCanonicalMissingCapabilities = missingCapabilities.length > 0
    && missingCapabilities.every((capability) => REQUIRED_PIPELINE_CAPABILITIES.includes(capability));
  const hasRuntimeConsistentMissingCapabilities = artifact.runtime_mode !== 'real-agent'
    || missingCapabilities.every((capability) => REAL_AGENT_BLOCKABLE_CAPABILITIES.includes(capability));
  const hasBlockedRuntimeMissingCapabilities = artifact.runtime_mode !== 'blocked-no-agent-runtime'
    || missingCapabilities.some((capability) => capability === 'spawn_agent' || capability === 'wait_agent');
  const blockedReason = artifact.reason === 'blocked-no-agent-runtime'
    && artifact.final_verdict
    && artifact.final_verdict.reason === 'blocked-no-agent-runtime';

  return artifact.pipeline_requested === true
    && artifact.pipeline_valid === false
    && ['blocked-no-agent-runtime', 'real-agent'].includes(artifact.runtime_mode)
    && artifact.status === 'BLOCKED'
    && blockedReason
    && artifact.manual_fallback_allowed === true
    && artifact.manual_fallback_counts_as_pipeline === false
    && artifact.final_verdict
    && artifact.final_verdict.status === 'BLOCKED'
    && hasCanonicalMissingCapabilities
    && hasRuntimeConsistentMissingCapabilities
    && hasBlockedRuntimeMissingCapabilities
    && gates.some((gate) => (
      gate
      && gate.gate === 'CAPABILITY_GATE'
      && gate.status === 'BLOCKED'
    ));
}

function findGovernanceArtifact(payload, stateDir) {
  const match = findGovernanceArtifactMatch(payload, stateDir);
  return match ? match.artifact : undefined;
}

function findGovernanceArtifactMatch(payload, stateDir) {
  const fromPayload = payload.pipelineGovernanceArtifact
    || payload.governanceArtifact
    || payload.pipeline_governance_artifact
    || (payload.output && typeof payload.output === 'object' ? payload.output.pipelineGovernanceArtifact : undefined)
    || (payload.output && typeof payload.output === 'object' ? payload.output.governanceArtifact : undefined)
    || (payload.output && typeof payload.output === 'object' ? payload.output.pipeline_governance_artifact : undefined);
  if (fromPayload && typeof fromPayload === 'object') {
    return { artifact: fromPayload, source: 'payload' };
  }

  for (const file of GOVERNANCE_ARTIFACT_FILES) {
    const candidate = readJsonIfExists(path.join(stateDir, file));
    if (candidate && typeof candidate === 'object') {
      return { artifact: candidate, source: 'file' };
    }
  }

  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  if (session && typeof session === 'object') {
    if (session.pipelineGovernanceArtifact && typeof session.pipelineGovernanceArtifact === 'object') {
      return { artifact: session.pipelineGovernanceArtifact, source: 'session' };
    }
    if (session.governanceArtifact && typeof session.governanceArtifact === 'object') {
      return { artifact: session.governanceArtifact, source: 'session' };
    }
  }

  return undefined;
}

function evaluateStopEnforcement(payload, rawInput) {
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const stateDir = path.join(cwd, '.codex', 'pipeline');
  const transcriptText = readTranscriptText(payload);
  const currentText = [rawInput, collectText(payload)].join('\n');
  const rawText = [currentText, transcriptText].join('\n');
  if (!pipelineWasExplicitlyRequested(payload, rawText, stateDir)) {
    return { ok: true, missing: [] };
  }

  if (!pipelineStateIsActive(stateDir) && !outputAttemptsPipelineCompletion(rawText) && !payloadContainsGovernanceArtifact(payload, stateDir)) {
    return { ok: true, missing: [] };
  }

  const artifactMatch = findGovernanceArtifactMatch(payload, stateDir);
  const artifact = artifactMatch ? artifactMatch.artifact : undefined;
  const ledgers = readLedgers(stateDir);
  if (
    artifactMatch
    && artifactRequiresCurrentRunIdentity(artifact)
    && !artifactMatchesActiveRun(artifact, ledgers, stateDir, {
      requireLedgerIdentity: !isStructuredBlockedPipelineArtifact(artifact),
    })
  ) {
    return { ok: false, missing: ['current_run_identity'] };
  }

  if (
    artifactMatch
    && isStructuredBlockedPipelineArtifact(artifact)
    && !outputClaimsSuccessfulPipelineCompletion(currentText)
    && artifactMatch.source !== 'payload'
  ) {
    return { ok: false, missing: ['current_run_identity'] };
  }

  if (isStructuredBlockedPipelineArtifact(artifact) && !outputClaimsSuccessfulPipelineCompletion(currentText)) {
    return { ok: true, missing: [] };
  }

  const validation = validateGovernanceArtifact(artifact, ledgers, stateDir);
  if (artifactRequiresCurrentRunIdentity(artifact) && !isStructuredBlockedPipelineArtifact(artifact)) {
    const missingIntegrity = validatePassArtifactIntegrity(stateDir);
    if (missingIntegrity.length > 0) {
      return {
        ok: false,
        missing: validation.ok
          ? missingIntegrity
          : [...validation.missing, ...missingIntegrity],
      };
    }
  }
  return validation.ok ? { ok: true, missing: [] } : validation;
}

/**
 * Detecta se alguma spec com audit_source existe no projeto.
 * Retorna lista de specs de auditoria encontradas.
 */
function findAuditSourcedSpecs() {
  const specsDir = path.join(process.cwd(), '.kiro', 'specs');
  const found = [];
  try {
    if (!fs.existsSync(specsDir)) return found;
    const dirs = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const specJsonPath = path.join(specsDir, dir.name, 'spec.json');
      try {
        if (!fs.existsSync(specJsonPath)) continue;
        const specJson = JSON.parse(fs.readFileSync(specJsonPath, 'utf8'));
        // Only flag specs that are not yet closed/completed and have audit_source
        if (specJson.audit_source && specJson.phase !== 'closed') {
          found.push({
            name: dir.name,
            audit_source: specJson.audit_source,
            phase: specJson.phase || 'unknown'
          });
        }
      } catch { /* ignore parse errors */ }
    }
  } catch { /* ignore fs errors */ }
  return found;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const payload = parsePayload(input);
    const stopEnforcement = evaluateStopEnforcement(payload, input);
    if (!stopEnforcement.ok) {
      recordHookEvent({
        hook: 'completion-checklist',
        event: 'Stop',
        decision: 'block_missing_governance_artifact',
        reason: 'explicit pipeline completion attempted without validated governance artifact',
      });

      console.log(JSON.stringify({
        continue: false,
        stopReason: `Pipeline completion blocked: missing governance evidence: ${stopEnforcement.missing.join(', ')}`,
        systemMessage: [
          'PIPELINE STOP ENFORCEMENT: explicit pipeline completion requires a validated PipelineGovernanceArtifact.',
          'Emit BLOCKED with pipeline_valid=false, or complete the missing gates/hooks/agent artifacts before finalizing.',
        ].join('\n'),
      }));
      return;
    }

    const contextParts = [
      '## Checklist de Conclusao (auto-injetado)',
      '',
    ];

    // Kiro-specific rules — only include if .kiro directory exists
    const kiroDir = path.join(process.cwd(), '.kiro');
    if (fs.existsSync(kiroDir)) {
      contextParts.push(
        '### Regras Inegociaveis (.kiro/steering/golden-rule.md)',
        '- [ ] Regra 1: Spec → Design → Tasks antes de codigo?',
        '- [ ] Regra 2: Evidencia acima de suposicao?',
        '- [ ] Regra 3: Mudanca minima, diff minimo?',
        '- [ ] Regra 5: SSOT — regras criticas no backend?',
        '- [ ] Regra 10: Build obrigatorio, max 2 tentativas?',
        '- [ ] Regra 15: Nao-Invencao — lacunas preenchidas sem perguntar?',
        '- [ ] Regra 16: Execucao Nao-Assumptiva — so o que foi pedido?',
        '',
        '### SSOT (.kiro/steering/authority-map.md)',
        '- [ ] Dominio tocado tem SSOT unica? (recusa se 2 fontes detectadas)',
        '',
      );
    }

    contextParts.push(
      '### Pipeline',
      '- [ ] ORCHESTRATOR_DECISION emitido no inicio?',
      '',
      '### Qualidade',
      '- [ ] Build/validacao executada? (use o comando de build do projeto)',
      '- [ ] Testes executados (se existirem)? (use o comando de test do projeto)',
      '- [ ] Testes passaram? TDD RED->GREEN se implementou codigo',
      '- [ ] Sem regressoes? Suite de regressao do CHECKPOINT passa',
    );

    // v2.0: Check for audit-sourced specs
    const auditSpecs = findAuditSourcedSpecs();
    if (auditSpecs.length > 0) {
      contextParts.push('');
      contextParts.push('### Coverage Gate — Specs de Auditoria (OBRIGATORIO)');
      contextParts.push(`Specs de auditoria detectadas: ${auditSpecs.map(s => s.name).join(', ')}`);
      contextParts.push('');
      for (const spec of auditSpecs) {
        contextParts.push(`**${spec.name}** (fase: ${spec.phase}, audit: ${spec.audit_source})`);
      }
      contextParts.push('');
      contextParts.push('- [ ] Coverage Gate emitido? (tabela gap→AC→task, TODOS os gaps cobertos)');
      contextParts.push('- [ ] Priority Consistency? (gap P0 nunca em slice P2)');
      contextParts.push('- [ ] /kiro:validate-spec rodado? (12 eixos de conteudo, alem do Spec Gate de formato)');
      contextParts.push('');
      contextParts.push('Se qualquer item acima NAO foi cumprido, complete antes de finalizar.');
      contextParts.push('Ref: memory/spec-from-audit-checklist.md');
    }

    // v3.0: Pipeline phase enforcement (always inject — approach B)
    contextParts.push('');
    contextParts.push('### Pipeline Orchestrator — Fases Obrigatorias');
    contextParts.push('Se /pipeline-orchestrator-for-codex:pipeline foi invocado nesta sessao, TODAS as fases devem ter sido executadas:');
    contextParts.push('- [ ] Phase 0: task-orchestrator spawnado (CLASSIFICATION emitida)?');
    contextParts.push('- [ ] Phase 0: information-gate spawnado (INFORMATION_GATE emitida)?');
    contextParts.push('- [ ] Phase 1: PIPELINE PROPOSAL apresentado e usuario confirmou?');
    contextParts.push('- [ ] Phase 2: executor-controller spawnado com batch execution?');
    contextParts.push('- [ ] Phase 2: checkpoint-validator rodou (build + test)?');
    contextParts.push('- [ ] Phase 3: sanity-checker spawnado com evidencia de comando + output?');
    contextParts.push('- [ ] Phase 3: final-validator (Pa de Cal) emitiu GO/CONDITIONAL/NO-GO?');
    contextParts.push('- [ ] Phase 3: finishing-branch apresentou opcoes de closeout?');
    contextParts.push('- [ ] Gate decisions logadas em gate-decisions.jsonl?');
    contextParts.push('- [ ] Artefato final estruturado emitido com pipeline_requested, pipeline_valid, gates, hooks, agents, manual_fallback e final_verdict?');
    contextParts.push('- [ ] CAPABILITY_GATE e FINAL_VERDICT_GATE presentes antes de qualquer PASS?');
    contextParts.push('- [ ] Phase transition summaries emitidos entre cada fase?');
    contextParts.push('');
    contextParts.push('Se /pipeline-orchestrator-for-codex:pipeline NAO foi invocado, ignore esta secao.');
    contextParts.push('Se alguma fase foi pulada, PARE e complete antes de finalizar.');

    contextParts.push('');
    contextParts.push('Se algum item nao foi cumprido, considere completar antes de finalizar.');
    contextParts.push('Se build falhou 2x: PARAR e analisar causa raiz (Stop Rule).');

    recordHookEvent({
      hook: 'completion-checklist',
      event: 'Stop',
      decision: 'inject_completion_checklist',
      reason: 'stop hook checklist emitted',
    });

    console.log(JSON.stringify({
      continue: true,
      additionalContext: contextParts.join('\n')
    }));

  } catch (e) {
    console.log(JSON.stringify({ continue: true }));
  }
});
