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
  canonicalize,
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
const WORKFLOW_INTENT_FILE = 'workflow-intent.json';
const REQUIRED_FIRST_ACTIONS_FILE = 'required-first-actions.json';
const REQUIRED_BATCH_LOOP_STEPS = [
  'checkpoint',
  'adversarial_review',
  'fix_loop',
];
const CONTROLLER_FQN = 'pipeline-orchestrator-for-codex:core:pipeline-controller';
const FOUNDATIONAL_BOOTSTRAP_CAPABILITY_ACTIONS = {
  spawn_agent: `spawn:${CONTROLLER_FQN}`,
  wait_agent: 'wait_agent',
};

const HMAC_SHA256_HEX_SIGNATURE = /^[0-9a-f]{64}$/iu;
const STALE_BLOCKED_RUNTIME_MS = 300_000;

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

function readRequiredStateFile(file) {
  if (!fs.existsSync(file)) {
    return { status: 'missing' };
  }
  try {
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
      return { status: 'invalid' };
    }
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state)
      ? { status: 'ok', state }
      : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
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

function explicitPipelineFrontDoorRequested(rawText) {
  if (/\/pipeline-orchestrator(?:-for-codex)?:pipeline\b/iu.test(rawText)) return true;
  if (/\[(?:[@$])?pipeline(?:\s|-)?orchestrator(?:\s|-)?for(?:\s|-)?codex\]\((?:plugin|app):\/\/pipeline-orchestrator-for-codex(?=[)@/?#])[^)]*\)/iu.test(rawText)) return true;
  if (/[@$]pipeline(?:\s|-)?orchestrator(?:\s|-)?for(?:\s|-)?codex\b/iu.test(rawText)) return true;
  return false;
}

function pipelineWasExplicitlyRequested(payload, rawText, stateDir) {
  if (explicitPipelineFrontDoorRequested(rawText)) return true;
  if (workflowObligationFileRequiresEnforcement(stateDir)) return true;
  if (activeWorkflowObligation(stateDir)) return true;
  if (activeSessionLock(stateDir)) return true;
  if (payloadContainsGovernanceArtifact(payload, stateDir)) return true;
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  if (
    sentinel
    && sentinel.pipelineActive === true
    && !isStaleBlockedRuntimeOrphan(stateDir, sentinel)
  ) return true;
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  return !!(
    session
    && !isStaleBlockedRuntimeOrphan(stateDir, session)
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
  if (
    sentinel
    && sentinel.pipelineActive === true
    && !isStaleBlockedRuntimeOrphan(stateDir, sentinel)
  ) return true;
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  return !!(
    session
    && session.pipelineActive === true
    && !isStaleBlockedRuntimeOrphan(stateDir, session)
  ) || activeSessionLock(stateDir);
}

function activeSessionLock(stateDir) {
  const lock = readJsonIfExists(path.join(stateDir, 'session-lock.json'));
  return !!(
    lock
    && typeof lock === 'object'
    && lock.status === 'active'
    && typeof lock.expires_at === 'number'
    && lock.expires_at > Math.floor(Date.now() / 1000)
  );
}

function activeWorkflowIntent(stateDir) {
  const intent = readJsonIfExists(path.join(stateDir, WORKFLOW_INTENT_FILE));
  return !!(
    intent
    && typeof intent === 'object'
    && intent.status === 'active'
    && intent.plugin === 'pipeline-orchestrator-for-codex'
    && !stateObjectExpired(intent)
  );
}

function activeRequiredFirstActions(stateDir) {
  const required = readJsonIfExists(path.join(stateDir, REQUIRED_FIRST_ACTIONS_FILE));
  return !!(
    required
    && typeof required === 'object'
    && required.status === 'active'
    && required.plugin === 'pipeline-orchestrator-for-codex'
    && !stateObjectExpired(required)
  );
}

function activeWorkflowObligation(stateDir) {
  return activeWorkflowIntent(stateDir) || activeRequiredFirstActions(stateDir);
}

function workflowObligationFileRequiresEnforcement(stateDir) {
  return [WORKFLOW_INTENT_FILE, REQUIRED_FIRST_ACTIONS_FILE].some((file) => {
    const stateFile = readRequiredStateFile(path.join(stateDir, file));
    return stateFile.status === 'invalid'
      || (stateFile.status === 'ok' && stateLooksLikePipelineObligation(stateFile.state));
  });
}

function readActiveRequiredFirstActions(stateDir) {
  const required = readJsonIfExists(path.join(stateDir, REQUIRED_FIRST_ACTIONS_FILE));
  if (
    required
    && typeof required === 'object'
    && required.status === 'active'
    && required.plugin === 'pipeline-orchestrator-for-codex'
    && !stateObjectExpired(required)
    && stateObjectIntegrityVerified(required, 'pipeline-required-first-actions')
  ) {
    return required;
  }
  return undefined;
}

function workflowObligationIntegrityIssues(stateDir) {
  const issues = [];
  const obligations = [
    {
      name: 'workflow_intent_integrity:hmac-sha256',
      stateFile: readRequiredStateFile(path.join(stateDir, WORKFLOW_INTENT_FILE)),
      scope: 'pipeline-workflow-intent',
    },
    {
      name: 'required_first_actions_integrity:hmac-sha256',
      stateFile: readRequiredStateFile(path.join(stateDir, REQUIRED_FIRST_ACTIONS_FILE)),
      scope: 'pipeline-required-first-actions',
    },
  ];

  for (const obligation of obligations) {
    if (obligation.stateFile.status === 'invalid') {
      issues.push(obligation.name);
      continue;
    }
    const state = obligation.stateFile.status === 'ok' ? obligation.stateFile.state : undefined;
    if (
      state
      && typeof state === 'object'
      && stateLooksLikePipelineObligation(state)
      && !stateObjectIntegrityVerified(state, obligation.scope)
    ) {
      issues.push(obligation.name);
    }
  }

  return issues;
}

function missingWorkflowObligationIssues(stateDir) {
  if (!pipelineStateIsActive(stateDir)) return [];
  const issues = [];
  if (readRequiredStateFile(path.join(stateDir, WORKFLOW_INTENT_FILE)).status === 'missing') {
    issues.push('workflow_intent:present');
  }
  if (readRequiredStateFile(path.join(stateDir, REQUIRED_FIRST_ACTIONS_FILE)).status === 'missing') {
    issues.push('required_first_actions:present');
  }
  return issues;
}

function stateLooksLikePipelineObligation(state) {
  if (!state || typeof state !== 'object') return false;
  if (
    state.plugin === 'pipeline-orchestrator-for-codex'
    && stateObjectExpired(state)
  ) {
    return false;
  }
  return true;
}

function stateObjectExpired(state) {
  if (typeof state.expires_at !== 'number') return true;
  return state.expires_at <= Math.floor(Date.now() / 1000);
}

function stateObjectIntegrityVerified(state, scope) {
  const key = resolveSentinelIntegrityHmacKey();
  if (!key) return true;

  const integrity = state && typeof state === 'object' ? state._integrity : undefined;
  if (
    !integrity
    || integrity.algorithm !== 'hmac-sha256'
    || integrity.scope !== scope
    || typeof integrity.signature !== 'string'
    || !HMAC_SHA256_HEX_SIGNATURE.test(integrity.signature)
  ) {
    return false;
  }

  const unsignedState = { ...state };
  delete unsignedState._integrity;
  const expected = crypto.createHmac('sha256', key).update(canonicalize(unsignedState)).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(integrity.signature, 'hex');
  return actualBytes.length > 0
    && expectedBytes.length === actualBytes.length
    && crypto.timingSafeEqual(expectedBytes, actualBytes);
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

function stepStatus(step) {
  if (!step || typeof step !== 'object') return undefined;
  return step.status;
}

function expectedBatchEvidenceRef(batchName, step) {
  return `batch:${batchName}:${step}`;
}

function ledgerBatchStepPassed(batchName, step, stepArtifact, ledgers, identityContext) {
  const evidenceRef = stepArtifact && typeof stepArtifact === 'object'
    ? stepArtifact.evidence_ref
    : undefined;
  if (evidenceRef !== expectedBatchEvidenceRef(batchName, step) || !ledgers) {
    return false;
  }
  const expectedGate = `BATCH_LOOP:${batchName}:${step}`;
  return (ledgers.gateDecisions ?? []).some((entry) => {
    if (
      !entry
      || !ledgerEntryIntegrityVerified(entry)
      || !entryMatchesActiveRunIdentity(entry, identityContext)
      || entry.gate !== expectedGate
      || entry.evidence_ref !== evidenceRef
      || !['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    ) {
      return false;
    }
    if (step !== 'fix_loop') return true;
    return Number.isInteger(entry.open_findings)
      && entry.open_findings === 0
      && Number.isInteger(entry.attempts)
      && entry.attempts >= 0
      && entry.attempts <= 3;
  });
}

function validateBatchLoopEvidence(artifact, ledgers = undefined, identityContext = undefined) {
  const missing = [];
  const batches = Array.isArray(artifact?.batches) ? artifact.batches : [];
  if (batches.length === 0) {
    return ['batch_loop:batches'];
  }

  for (const [index, batch] of batches.entries()) {
    const name = typeof batch?.name === 'string' && batch.name.trim()
      ? batch.name.trim()
      : `batch-${index + 1}`;
    if (!batch || typeof batch !== 'object') {
      missing.push(`batch:${name}:object`);
      continue;
    }
    if (batch.status !== 'PASS') {
      missing.push(`batch:${name}:status:PASS`);
    }
    for (const step of REQUIRED_BATCH_LOOP_STEPS) {
      const stepArtifact = batch[step];
      if (stepStatus(stepArtifact) !== 'PASS') {
        missing.push(`batch:${name}:${step}:PASS`);
      }
      const evidenceRef = stepArtifact && typeof stepArtifact === 'object'
        ? stepArtifact.evidence_ref
        : undefined;
      if (evidenceRef !== expectedBatchEvidenceRef(name, step)) {
        missing.push(`batch:${name}:${step}:evidence_ref`);
      } else if (ledgers && !ledgerBatchStepPassed(name, step, stepArtifact, ledgers, identityContext)) {
        missing.push(`ledger:batch:${name}:${step}`);
      }
    }
    const fixLoop = batch.fix_loop;
    if (!fixLoop || typeof fixLoop !== 'object') {
      continue;
    }
    if (!Number.isInteger(fixLoop.open_findings) || fixLoop.open_findings !== 0) {
      missing.push(`batch:${name}:fix_loop:open_findings:0`);
    }
    if (!Number.isInteger(fixLoop.attempts) || fixLoop.attempts < 0 || fixLoop.attempts > 3) {
      missing.push(`batch:${name}:fix_loop:attempts<=3`);
    }
  }

  return missing;
}

function ledgerEntryNotBeforeState(entry, state) {
  if (!state || typeof state !== 'object' || typeof state.created_at !== 'string') return true;
  if (typeof entry?.timestamp !== 'string') return false;
  const createdAt = Date.parse(state.created_at);
  const entryAt = Date.parse(entry.timestamp);
  return Number.isFinite(createdAt) && Number.isFinite(entryAt) && entryAt >= createdAt;
}

function ledgerRequiredActionCompleted(action, ledgers, identityContext, requiredState = undefined) {
  const allLedgers = [
    ...(ledgers.gateDecisions ?? []),
    ...(ledgers.checkpoints ?? []),
    ...(ledgers.hookEvents ?? []),
    ...(ledgers.protocolEvents ?? []),
  ];
  const requiredSpawnTarget = typeof action === 'string' && action.startsWith('spawn:')
    ? action.slice('spawn:'.length)
    : undefined;
  const requiredSpawnLeaf = requiredSpawnTarget ? requiredSpawnTarget.split(':').pop() : undefined;
  return allLedgers.some((entry) => (
    entry
    && ledgerEntryIntegrityVerified(entry)
    && entryMatchesActiveRunIdentity(entry, identityContext)
    && ledgerEntryNotBeforeState(entry, requiredState)
    && ['completed', 'PASS', 'pass', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.status || entry.decision)
    && (
      entry.action === action
      || entry.required_action === action
      || entry.completed_action === action
      || entry.gate === action
      || entry.kind === action
      || entry.event === action
      || (
        action === 'wait_agent'
        && entry.payload
        && typeof entry.payload === 'object'
        && entry.payload.capability === 'wait_agent'
        && entry.payload.event === 'WAIT_AGENT_COMPLETED'
      )
      || (
        requiredSpawnTarget
        && entry.kind === 'DISPATCH_REQUEST'
        && entry.payload
        && typeof entry.payload === 'object'
        && (
          entry.payload.targetName === requiredSpawnTarget
          || entry.payload.targetName === requiredSpawnLeaf
        )
      )
    )
  ));
}

function validateRequiredFirstActions(stateDir, ledgers, identityContext) {
  const required = readActiveRequiredFirstActions(stateDir);
  if (!required) return [];
  const missing = [];
  const requiredActions = Array.isArray(required.required_actions) ? required.required_actions : [];
  const completedActions = new Set(
    Array.isArray(required.completed_actions)
      ? required.completed_actions.filter((action) => typeof action === 'string')
      : [],
  );

  for (const action of requiredActions) {
    if (typeof action !== 'string' || action.trim().length === 0) {
      missing.push('required_action:valid');
      continue;
    }
    if (!completedActions.has(action) && !ledgerRequiredActionCompleted(action, ledgers, identityContext, required)) {
      missing.push(`required_action:${action}`);
    }
  }

  return missing;
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || value.trim().length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stateLastTouchedMs(state) {
  if (!state || typeof state !== 'object') return 0;
  return Math.max(
    timestampMs(state.updatedAt),
    timestampMs(state.updated_at),
    timestampMs(state.runStartedAt),
    timestampMs(state.created_at),
    timestampMs(state.timestamp),
  );
}

function isBlockedNoAgentRuntimeState(state) {
  return !!(
    state
    && typeof state === 'object'
    && (
      state.runtime_mode === 'blocked-no-agent-runtime'
      || state.pendingDecision === 'blocked-no-agent-runtime'
      || state.reason === 'blocked-no-agent-runtime'
    )
  );
}

function isStaleBlockedRuntimeOrphan(stateDir, state) {
  if (!isBlockedNoAgentRuntimeState(state)) return false;
  if (activeSessionLock(stateDir) || activeWorkflowObligation(stateDir) || workflowObligationFileRequiresEnforcement(stateDir)) {
    return false;
  }
  const lastTouched = stateLastTouchedMs(state);
  return lastTouched > 0 && Date.now() - lastTouched > STALE_BLOCKED_RUNTIME_MS;
}

function requiredFirstActionWasCompleted(stateDir, ledgers, action, identityContext) {
  const required = readActiveRequiredFirstActions(stateDir);
  if (!required) return false;
  const completedActions = new Set(
    Array.isArray(required.completed_actions)
      ? required.completed_actions.filter((entry) => typeof entry === 'string')
      : [],
  );
  return completedActions.has(action)
    || ledgerRequiredActionCompleted(action, ledgers, identityContext, required);
}

function validateBlockedRuntimeCapabilityContradictions(artifact, stateDir, ledgers, identityContext) {
  if (!isStructuredBlockedPipelineArtifact(artifact)) return [];
  const missingCapabilities = Array.isArray(artifact.missing_capabilities)
    ? artifact.missing_capabilities
    : [];
  const contradictions = [];

  for (const [capability, action] of Object.entries(FOUNDATIONAL_BOOTSTRAP_CAPABILITY_ACTIONS)) {
    if (
      missingCapabilities.includes(capability)
      && requiredFirstActionWasCompleted(stateDir, ledgers, action, identityContext)
    ) {
      contradictions.push(`missing_capability_contradicts_bootstrap:${capability}`);
    }
  }

  return contradictions;
}

function requiredFirstActionsIncomplete(stateDir) {
  const raw = readJsonIfExists(path.join(stateDir, REQUIRED_FIRST_ACTIONS_FILE));
  if (raw?.corrupted) return true;
  if (
    raw
    && typeof raw === 'object'
    && raw.status === 'active'
    && raw.plugin === 'pipeline-orchestrator-for-codex'
    && !stateObjectExpired(raw)
    && !stateObjectIntegrityVerified(raw, 'pipeline-required-first-actions')
  ) {
    return true;
  }
  const required = readActiveRequiredFirstActions(stateDir);
  if (!required) return false;
  const requiredActions = Array.isArray(required.required_actions) ? required.required_actions : [];
  const completedActions = new Set(
    Array.isArray(required.completed_actions)
      ? required.completed_actions.filter((action) => typeof action === 'string')
      : [],
  );
  return requiredActions.some((action) => typeof action === 'string' && !completedActions.has(action));
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
  if (artifact.exec_window_enforcement !== 'cooperative') missing.push('exec_window_enforcement:cooperative');
  if (artifact.status !== 'PASS') missing.push('status:PASS');
  if (artifact.manual_fallback_counts_as_pipeline !== false) missing.push('manual_fallback_counts_as_pipeline:false');
  if (!artifact.final_verdict || artifact.final_verdict.status !== 'PASS') missing.push('final_verdict:PASS');
  const identityContext = stateDir ? activeRunIdentityContext(stateDir) : undefined;
  missing.push(...validateBatchLoopEvidence(artifact, ledgers, identityContext));
  if (stateDir && ledgers) {
    missing.push(...validateRequiredFirstActions(stateDir, ledgers, identityContext));
  }

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

  if (ledgers) {
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
  const currentText = [rawInput, collectText(payload)].join('\n');
  const workflowObligationFilePresent = workflowObligationFileRequiresEnforcement(stateDir);
  const explicitFrontDoorRequested = explicitPipelineFrontDoorRequested(currentText);
  if (!pipelineWasExplicitlyRequested(payload, currentText, stateDir)) {
    return { ok: true, missing: [] };
  }

  if (
    !explicitFrontDoorRequested
    && !activeWorkflowObligation(stateDir)
    && !workflowObligationFilePresent
    && !activeSessionLock(stateDir)
    && !pipelineStateIsActive(stateDir)
    && !outputAttemptsPipelineCompletion(currentText)
    && !payloadContainsGovernanceArtifact(payload, stateDir)
  ) {
    return { ok: true, missing: [] };
  }

  const artifactMatch = findGovernanceArtifactMatch(payload, stateDir);
  const artifact = artifactMatch ? artifactMatch.artifact : undefined;
  const ledgers = readLedgers(stateDir);
  const missingObligationIssues = missingWorkflowObligationIssues(stateDir);
  const obligationIntegrityIssues = workflowObligationIntegrityIssues(stateDir);
  const obligationIssues = [...missingObligationIssues, ...obligationIntegrityIssues];
  if (obligationIntegrityIssues.length > 0) {
    return {
      ok: false,
      missing: obligationIntegrityIssues,
    };
  }

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
    if (obligationIntegrityIssues.length > 0) {
      return {
        ok: false,
        missing: obligationIntegrityIssues,
      };
    }
    const identityContext = activeRunIdentityContext(stateDir);
    const blockedCapabilityContradictions = validateBlockedRuntimeCapabilityContradictions(
      artifact,
      stateDir,
      ledgers,
      identityContext,
    );
    if (blockedCapabilityContradictions.length > 0) {
      return {
        ok: false,
        missing: blockedCapabilityContradictions,
      };
    }
    const blockedObligationIssues = [
      ...missingObligationIssues,
      ...validateRequiredFirstActions(stateDir, ledgers, identityContext),
    ];
    if (blockedObligationIssues.length > 0) {
      return {
        ok: false,
        missing: blockedObligationIssues,
      };
    }
    return { ok: true, missing: [] };
  }

  const validation = validateGovernanceArtifact(artifact, ledgers, stateDir);
  const validationWithObligations = obligationIssues.length > 0
    ? {
        ok: false,
        missing: [...validation.missing, ...obligationIssues],
      }
    : validation;
  if (artifactRequiresCurrentRunIdentity(artifact) && !isStructuredBlockedPipelineArtifact(artifact)) {
    const missingIntegrity = validatePassArtifactIntegrity(stateDir);
    if (missingIntegrity.length > 0) {
      return {
        ok: false,
        missing: validationWithObligations.ok
          ? missingIntegrity
          : [...validationWithObligations.missing, ...missingIntegrity],
      };
    }
  }
  return validationWithObligations.ok ? { ok: true, missing: [] } : validationWithObligations;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const payload = parsePayload(input);
    // Codex/Claude retry Stop with stop_hook_active=true; short-circuit before any
    // governance evaluation so a still-incomplete pipeline cannot trap the stop in a loop.
    if (payload && payload.stop_hook_active === true) {
      recordHookEvent({
        hook: 'completion-checklist',
        event: 'Stop',
        decision: 'allow_stop_hook_active_retry',
        reason: 'stop_hook_active retry; governance may still be incomplete; allowing stop to prevent loop',
      });
      console.log(JSON.stringify({ continue: true }));
      return;
    }
    const stopEnforcement = evaluateStopEnforcement(payload, input);
    if (!stopEnforcement.ok) {
      const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
      const stateDir = path.join(cwd, '.codex', 'pipeline');
      const hasRequiredFirstActionGap = stopEnforcement.missing.some((entry) => (
        typeof entry === 'string' && entry.startsWith('required_action:')
      )) || requiredFirstActionsIncomplete(stateDir);
      recordHookEvent({
        hook: 'completion-checklist',
        event: 'Stop',
        decision: 'block_missing_governance_artifact',
        reason: 'explicit pipeline completion attempted without validated governance artifact',
      });

      const systemMessage = hasRequiredFirstActionGap
        ? [
            'PIPELINE STOP ENFORCEMENT: required first actions are incomplete.',
            'Do not stop or switch to manual fallback. Redirect immediately to the canonical sequence: update_plan, WORKFLOW_METHOD_GATE, CAPABILITY_GATE, spawn_agent with PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller, then wait_agent.',
            'Emit BLOCKED only if the real runtime capability is unavailable after attempting the canonical recovery path.',
          ].join('\n')
        : [
            'PIPELINE STOP ENFORCEMENT: explicit pipeline completion requires a validated PipelineGovernanceArtifact.',
            'Emit BLOCKED with pipeline_valid=false, or complete the missing gates/hooks/agent artifacts before finalizing.',
          ].join('\n');
      console.log(JSON.stringify({
        continue: false,
        decision: 'block',
        reason: systemMessage,
        stopReason: `Pipeline completion blocked: missing governance evidence: ${stopEnforcement.missing.join(', ')}`,
        systemMessage,
      }));
      return;
    }

    recordHookEvent({
      hook: 'completion-checklist',
      event: 'Stop',
      decision: 'allow_stop',
      reason: 'stop hook emitted Codex Stop-compatible success JSON',
    });

    console.log(JSON.stringify({ continue: true }));

  } catch (e) {
    const systemMessage = 'completion-checklist hook failed internally; inline completion is blocked because pipeline stop enforcement could not be proven.';
    console.log(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: systemMessage,
      stopReason: 'pipeline-stop-hook-error',
      systemMessage,
    }));
  }
});
