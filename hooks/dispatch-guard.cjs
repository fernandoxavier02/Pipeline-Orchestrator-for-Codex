#!/usr/bin/env node
'use strict';

/**
 * dispatch-guard.cjs — PreToolUse:spawn_agent / PreToolUse:Agent / PreToolUse:Skill guard.
 *
 * Enforces the dispatch contract:
 *   - Pipeline agents must be spawned via Codex spawn_agent with FQN marker
 *     "pipeline-orchestrator-for-codex:<folder>:<leaf>".
 *   - Calling a pipeline agent leaf via Skill is denied.
 *   - Bare leaf names (no namespace) are denied with a hint.
 *
 * Output contract (Codex PreToolUse hook):
 *   exit 0 + {} → allow
 *   exit 0 + { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } } → deny
 */

const { recordHookEvent } = require('./hook-events.cjs');
const { GOVERNED_SKILL_SET } = require('./governed-workflows.cjs');
const {
  canonicalize,
  ledgerEntryIntegrityVerified,
  resolveSentinelIntegrityHmacKey,
  stateObjectIntegrityVerified,
} = require('./ledger-integrity.cjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIPELINE_NAMESPACE = 'pipeline-orchestrator-for-codex';
const LEGACY_PIPELINE_NAMESPACE = 'pipeline-orchestrator';
const REQUIRED_FIRST_ACTIONS_FILE = path.join('.codex', 'pipeline', 'required-first-actions.json');
const CONTROLLER_FQN = `${PIPELINE_NAMESPACE}:core:pipeline-controller`;
const GOVERNED_SKILLS = GOVERNED_SKILL_SET;
const ALLOWED_AGENT_TYPES = new Set(['worker', 'default', 'explorer']);
const ALLOWED_GATES_AT = new Set(['phase-0', 'phase-1', 'phase-1.5', 'phase-2', 'phase-3', 'continue']);
const ALLOWED_SENTINEL_CHECKPOINTS = new Set([
  'post_orchestrator',
  'phase_0_to_1',
  'phase_1_to_2',
  'phase_2_to_3',
  'post_final_validator',
]);

const PIPELINE_AGENT_LEAVES = [
  ['brainstorm', 'step-00-intake'],
  ['brainstorm', 'step-01-explore'],
  ['core', 'brainstorm-controller'],
  ['core', 'adversarial-batch'],
  ['core', 'checkpoint-validator'],
  ['core', 'final-validator'],
  ['core', 'finishing-branch'],
  ['core', 'information-gate'],
  ['core', 'pipeline-controller'],
  ['core', 'sanity-checker'],
  ['core', 'sentinel'],
  ['core', 'task-orchestrator'],
  ['executor', 'executor-controller'],
  ['executor', 'executor-fix'],
  ['executor', 'executor-implementer-task'],
  ['executor', 'executor-quality-reviewer'],
  ['executor', 'executor-spec-reviewer'],
  ['executor:type-specific', 'adversarial-architecture-critic'],
  ['executor:type-specific', 'adversarial-review-coordinator'],
  ['executor:type-specific', 'adversarial-security-scanner'],
  ['executor:type-specific', 'audit-compliance-checker'],
  ['executor:type-specific', 'audit-domain-analyzer'],
  ['executor:type-specific', 'audit-intake'],
  ['executor:type-specific', 'audit-risk-matrix-generator'],
  ['executor:type-specific', 'bugfix-diagnostic-agent'],
  ['executor:type-specific', 'bugfix-regression-tester'],
  ['executor:type-specific', 'bugfix-root-cause-analyzer'],
  ['executor:type-specific', 'feature-implementer'],
  ['executor:type-specific', 'feature-integration-validator'],
  ['executor:type-specific', 'feature-vertical-slice-planner'],
  ['executor:type-specific', 'ux-accessibility-auditor'],
  ['executor:type-specific', 'ux-qa-validator'],
  ['executor:type-specific', 'ux-simulator'],
  ['quality', 'architecture-reviewer'],
  ['quality', 'design-interrogator'],
  ['quality', 'final-adversarial-orchestrator'],
  ['quality', 'plan-architect'],
  ['quality', 'pre-tester'],
  ['quality', 'quality-gate-router'],
  ['quality', 'review-orchestrator'],
  ['quality', 'adversarial-quality-reviewer'],
  ['quality', 'spec-format-gate'],
  ['quality', 'spec-content-reviewer'],
  ['quality', 'spec-post-impl-validator'],
  ['quality', 'spec-closer'],
];

const LEAF_TO_FQN = new Map(
  PIPELINE_AGENT_LEAVES.map(([folder, leaf]) => [leaf, `${PIPELINE_NAMESPACE}:${folder}:${leaf}`]),
);

function isPipelineAgentLeaf(name) {
  return LEAF_TO_FQN.has(name);
}

function fqnFor(leaf) {
  return LEAF_TO_FQN.get(leaf);
}

function skillLeafName(toolInput) {
  const skillName = (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name)) || '';
  return skillName.includes(':') ? skillName.split(':').pop() : skillName;
}

function deny(reason, attempted, expected) {
  recordHookEvent({
    hook: 'dispatch-guard',
    event: 'PreToolUse',
    decision: 'deny',
    attempted: attempted || '',
    expected: expected || '',
    reason,
  });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function allow() {
  // Silent allow (consistent with sentinel hook)
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return undefined;
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return { corrupted: true };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { corrupted: true };
  }
}

function readJsonlIfExists(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return [];
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function stateObjectExpired(state) {
  return typeof state.expires_at !== 'number' || state.expires_at <= Math.floor(Date.now() / 1000);
}

function ledgerEntryStatusCompleted(entry) {
  return ['completed', 'PASS', 'pass', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED']
    .includes(entry?.status || entry?.decision);
}

function ledgerEntryTrusted(entry) {
  return resolveSentinelIntegrityHmacKey()
    ? ledgerEntryIntegrityVerified(entry)
    : !!(entry && typeof entry === 'object' && !Array.isArray(entry));
}

function collectStrings(...values) {
  return values.flatMap((value) => {
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
    if (Array.isArray(value)) {
      return collectStrings(...value);
    }
    return [];
  });
}

function collectObjectStrings(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectObjectStrings(entry, keys, depth + 1));
  const found = [];
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key)) {
      found.push(...collectStrings(entry));
    }
    if (entry && typeof entry === 'object') {
      found.push(...collectObjectStrings(entry, keys, depth + 1));
    }
  }
  return found;
}

function entryMatchesRequiredState(entry, state) {
  if (!state || typeof state !== 'object') return true;
  const payload = entry?.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
    ? entry.payload
    : {};
  const identity = entry?.execution_identity && typeof entry.execution_identity === 'object' && !Array.isArray(entry.execution_identity)
    ? entry.execution_identity
    : {};
  const runCandidates = collectStrings(entry?.run_id, entry?.runId, payload.run_id, payload.runId, identity.run_id, identity.runId);
  const sessionCandidates = collectStrings(
    entry?.session_id,
    entry?.sessionId,
    payload.session_id,
    payload.sessionId,
    identity.session_id,
    identity.sessionId,
  );
  if (typeof state.run_id === 'string' && runCandidates.length > 0 && !runCandidates.includes(state.run_id)) return false;
  if (typeof state.session_id === 'string' && sessionCandidates.length > 0 && !sessionCandidates.includes(state.session_id)) return false;
  const hasIdentity = runCandidates.length > 0 || sessionCandidates.length > 0;
  if (typeof state.created_at !== 'string') return hasIdentity;
  if (typeof entry?.timestamp !== 'string') return false;
  const createdAt = Date.parse(state.created_at);
  const entryAt = Date.parse(entry.timestamp);
  const currentEnough = Number.isFinite(createdAt) && Number.isFinite(entryAt) && entryAt >= createdAt;
  return currentEnough;
}

function ledgerRequiredActionCompleted(action, stateDir, state) {
  const requiredSpawnTarget = typeof action === 'string' && action.startsWith('spawn:')
    ? action.slice('spawn:'.length)
    : undefined;
  const requiredSpawnLeaf = requiredSpawnTarget ? requiredSpawnTarget.split(':').pop() : undefined;
  const entries = [
    ...readJsonlIfExists(path.join(stateDir, 'gate-decisions.jsonl')),
    ...readJsonlIfExists(path.join(stateDir, 'protocol-events.jsonl')),
    ...readJsonlIfExists(path.join(stateDir, 'hook-events.jsonl')),
  ];
  return entries.some((entry) => (
    entry
    && ledgerEntryTrusted(entry)
    && entryMatchesRequiredState(entry, state)
    && ledgerEntryStatusCompleted(entry)
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
        && entry.status === 'completed'
        && entry.dispatchMode === 'real'
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

function readRequiredFirstActionsState() {
  const stateDir = path.join(process.cwd(), '.codex', 'pipeline');
  const state = readJsonIfExists(path.join(process.cwd(), REQUIRED_FIRST_ACTIONS_FILE));
  if (!state) return undefined;
  if (state.corrupted) {
    return { active: true, pending: true, corrupted: true, requiredActions: [], completedActions: new Set() };
  }
  if (!stateObjectIntegrityVerified(state, 'pipeline-required-first-actions')) {
    return { active: true, pending: true, corrupted: true, requiredActions: [], completedActions: new Set() };
  }
  if (
    !state
    || typeof state !== 'object'
    || state.status !== 'active'
    || state.plugin !== PIPELINE_NAMESPACE
    || stateObjectExpired(state)
  ) {
    return undefined;
  }
  const requiredActions = Array.isArray(state.required_actions)
    ? state.required_actions.filter((entry) => typeof entry === 'string')
    : [];
  const completedActions = new Set(
    Array.isArray(state.completed_actions)
      ? state.completed_actions.filter((entry) => typeof entry === 'string')
      : [],
  );
  return {
    active: true,
    pending: requiredActions.some((action) => (
      !completedActions.has(action) && !ledgerRequiredActionCompleted(action, stateDir, state)
    )),
    corrupted: false,
    state,
    requiredActions,
    completedActions,
  };
}

function signStateObject(state, scope) {
  const key = resolveSentinelIntegrityHmacKey();
  if (!key) return state;
  const unsignedState = { ...state };
  delete unsignedState._integrity;
  return {
    ...unsignedState,
    _integrity: {
      algorithm: 'hmac-sha256',
      scope,
      signature: crypto.createHmac('sha256', key).update(canonicalize(unsignedState)).digest('hex'),
    },
  };
}

function rejectSymlinkAncestors(file) {
  const cwd = process.cwd();
  const relative = path.relative(cwd, file).split(path.sep).filter(Boolean);
  let cursor = cwd;
  for (const part of relative.slice(0, -1)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Refusing to write pipeline state through symlink ancestor: ${cursor}`);
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing to write')) throw err;
    }
  }
}

function writeJsonAtomic(file, value) {
  rejectSymlinkAncestors(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  for (const candidate of [dir, file, tmpFile]) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Refusing to write pipeline state through symlink: ${candidate}`);
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing to write')) throw err;
    }
  }
  fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpFile, file);
}

function recordRequiredFirstActionCompleted(action, detail, updates = {}) {
  const requiredPath = path.join(process.cwd(), REQUIRED_FIRST_ACTIONS_FILE);
  const state = readJsonIfExists(requiredPath);
  if (
    state
    && !state.corrupted
    && typeof state === 'object'
    && state.status === 'active'
    && state.plugin === PIPELINE_NAMESPACE
    && !stateObjectExpired(state)
    && stateObjectIntegrityVerified(state, 'pipeline-required-first-actions')
  ) {
    const completedActions = new Set(
      Array.isArray(state.completed_actions)
        ? state.completed_actions.filter((entry) => typeof entry === 'string')
        : [],
    );
    const actions = Array.isArray(action) ? action : [action];
    for (const entry of actions) {
      if (typeof entry === 'string' && entry.length > 0) completedActions.add(entry);
    }
    writeJsonAtomic(requiredPath, signStateObject({
      ...state,
      ...updates,
      completed_actions: [...completedActions],
      updated_at: new Date().toISOString(),
    }, 'pipeline-required-first-actions'));
  }

  recordHookEvent({
    hook: 'dispatch-guard',
    event: Array.isArray(action) ? action.join(',') : action,
    decision: 'completed',
    attempted: Array.isArray(action) ? action.join(',') : action,
    expected: 'required-first-actions',
    reason: detail || 'required first action observed',
  });
}

function toolSucceeded(payload) {
  const response = payload && (payload.tool_response || payload.toolResponse);
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  if (response.is_error === true || response.error === true) return false;
  const status = typeof response.status === 'string' ? response.status.toLowerCase() : '';
  if (['error', 'failed', 'failure', 'denied', 'blocked'].includes(status)) return false;
  return true;
}

function extractAgentIdFromResponse(payload) {
  const response = payload && (payload.tool_response || payload.toolResponse || payload.result || payload.output);
  if (!response) return undefined;
  let parsedResponse = response;
  if (typeof parsedResponse === 'string') {
    try {
      parsedResponse = JSON.parse(parsedResponse);
    } catch {
      return collectStrings(parsedResponse)[0];
    }
  }
  if (typeof parsedResponse !== 'object' || Array.isArray(parsedResponse)) return collectStrings(parsedResponse)[0];
  return collectStrings(
    collectObjectStrings(parsedResponse, new Set([
      'agent_id',
      'agentId',
      'agent',
      'id',
      'target',
      'target_id',
      'targetId',
      'thread_id',
      'threadId',
    ])),
    response.agent_id,
    response.agentId,
    response.id,
    response.target,
    response.target_id,
    response.targetId,
    response.output && typeof response.output === 'object' ? response.output.agent_id : undefined,
    response.output && typeof response.output === 'object' ? response.output.agentId : undefined,
    response.output && typeof response.output === 'object' ? response.output.id : undefined,
  )[0];
}

function extractWaitTargets(toolInput) {
  return collectStrings(
    toolInput?.target,
    toolInput?.targets,
    toolInput?.agent,
    toolInput?.agents,
    toolInput?.agent_id,
    toolInput?.agentId,
    toolInput?.agent_ids,
    toolInput?.agentIds,
    toolInput?.thread_id,
    toolInput?.threadId,
    toolInput?.id,
  );
}

function actionEvidenceText(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  return collectStrings(
    collectObjectStrings(toolInput, new Set([
      'message',
      'prompt',
      'description',
      'explanation',
      'plan',
      'step',
      'steps',
      'status',
      'gate',
      'decision',
    ])),
    toolInput.message,
    toolInput.prompt,
    toolInput.description,
    toolInput.explanation,
    toolInput.plan,
    toolInput.step,
    toolInput.steps,
  ).join('\n');
}

function bootstrapGateActionsFromToolInput(toolInput) {
  const text = actionEvidenceText(toolInput);
  const actions = [];
  if (/\bWORKFLOW_METHOD_GATE\b[\s:=/-]*(approved|pass|passed|confirmed|ok|sim|selected|accepted)/iu.test(text)) {
    actions.push('WORKFLOW_METHOD_GATE');
  }
  if (/\bCAPABILITY_GATE\b[\s:=/-]*(pass|passed|approved|available|ok|confirmed)/iu.test(text)) {
    actions.push('CAPABILITY_GATE');
  }
  return actions;
}

function activeFirstActionsPostTool(payload, toolName, toolInput) {
  const required = readRequiredFirstActionsState();
  if (!required?.active || !required.pending || !toolSucceeded(payload)) return undefined;

  if (toolName === 'update_plan') {
    recordRequiredFirstActionCompleted('update_plan', 'visible plan tool completed');
    return { kind: 'allow' };
  }

  if (toolName === 'wait_agent') {
    const expectedControllerAgentId = typeof required.state?.bootstrap_controller_agent_id === 'string'
      ? required.state.bootstrap_controller_agent_id
      : undefined;
    const spawnAction = `spawn:${CONTROLLER_FQN}`;
    const spawnCompleted = required.completedActions.has(spawnAction)
      || ledgerRequiredActionCompleted(spawnAction, path.join(process.cwd(), '.codex', 'pipeline'), required.state);
    if (!expectedControllerAgentId && spawnCompleted) {
      recordRequiredFirstActionCompleted('wait_agent', 'wait_agent completed after bootstrap controller spawn');
      return { kind: 'allow' };
    }
    if (!expectedControllerAgentId || !extractWaitTargets(toolInput).includes(expectedControllerAgentId)) {
      recordRequiredFirstActionAllowed('wait_agent', 'wait_agent completed but did not match bootstrap controller id');
      return { kind: 'allow' };
    }
    recordRequiredFirstActionCompleted('wait_agent', 'wait_agent tool completed for bootstrap controller');
    return { kind: 'allow' };
  }

  if (toolName === 'spawn_agent') {
    const identity = extractPipelineAgentType(toolInput, { requireMarker: true });
    if (typeof identity === 'string' && identity === CONTROLLER_FQN) {
      const bootstrapControllerAgentId = extractAgentIdFromResponse(payload);
      recordRequiredFirstActionCompleted(
        `spawn:${CONTROLLER_FQN}`,
        'canonical controller spawn completed',
        bootstrapControllerAgentId ? { bootstrap_controller_agent_id: bootstrapControllerAgentId } : {},
      );
      return { kind: 'allow' };
    }
  }

  return undefined;
}

function recordRequiredFirstActionAllowed(action, detail) {
  recordHookEvent({
    hook: 'dispatch-guard',
    event: action,
    decision: 'allow',
    attempted: action,
    expected: 'required-first-actions',
    reason: detail || 'required first action allowed',
  });
}

function activeFirstActionsPreTool(toolName, toolInput) {
  const required = readRequiredFirstActionsState();
  if (!required?.active || !required.pending) return undefined;
  const pipelineDir = path.join(process.cwd(), '.codex', 'pipeline');
  const requiredActionSatisfied = (action) => (
    required.completedActions.has(action)
    || ledgerRequiredActionCompleted(action, pipelineDir, required.state)
  );

  if (toolName === 'update_plan') {
    recordRequiredFirstActionCompleted('update_plan', 'visible plan tool observed');
    return { kind: 'allow' };
  }

  if (toolName === 'wait_agent') {
    const spawnAction = `spawn:${CONTROLLER_FQN}`;
    if (
      !required.completedActions.has(spawnAction)
      && !ledgerRequiredActionCompleted(spawnAction, path.join(process.cwd(), '.codex', 'pipeline'), required.state)
    ) {
      return {
        kind: 'deny',
        reason:
          `FIRST_ACTIONS_GUARD: wait_agent cannot run before the canonical pipeline-controller spawn is completed. ` +
          `Do not stop or switch to manual fallback; redirect immediately to the canonical controller bootstrap sequence.`,
        attempted: toolName,
        expected: CONTROLLER_FQN,
      };
    }
    const expectedControllerAgentId = typeof required.state?.bootstrap_controller_agent_id === 'string'
      ? required.state.bootstrap_controller_agent_id
      : undefined;
    if (expectedControllerAgentId && !extractWaitTargets(toolInput).includes(expectedControllerAgentId)) {
      return {
        kind: 'deny',
        reason:
          `FIRST_ACTIONS_GUARD: wait_agent must target the bootstrap pipeline-controller agent before the controller bootstrap is complete. ` +
          `Do not stop or switch to manual fallback; wait for the controller agent returned by the canonical spawn.`,
        attempted: toolName,
        expected: expectedControllerAgentId,
      };
    }
    recordRequiredFirstActionAllowed('wait_agent', 'wait_agent tool allowed');
    return { kind: 'allow' };
  }

  if (toolName === 'spawn_agent') {
    const identity = extractPipelineAgentType(toolInput, { requireMarker: true });
    if (typeof identity === 'string' && identity === CONTROLLER_FQN) {
      const missingPrerequisites = [
        'update_plan',
        'WORKFLOW_METHOD_GATE',
        'CAPABILITY_GATE',
      ].filter((action) => (
        !requiredActionSatisfied(action)
        && !bootstrapGateActionsFromToolInput(toolInput).includes(action)
      ));
      if (missingPrerequisites.length > 0) {
        return {
          kind: 'deny',
          reason:
            `FIRST_ACTIONS_GUARD: canonical pipeline-controller spawn cannot run before ` +
            `${missingPrerequisites.join(', ')} complete. ` +
            `Do not stop or switch to manual fallback; run the visible plan and mandatory gates first.`,
          attempted: identity,
          expected: missingPrerequisites.join(','),
        };
      }
      const gateActions = bootstrapGateActionsFromToolInput(toolInput)
        .filter((action) => !requiredActionSatisfied(action));
      if (gateActions.length > 0) {
        recordRequiredFirstActionCompleted(gateActions, 'bootstrap gate evidence observed in controller spawn request');
      }
      recordRequiredFirstActionAllowed(`spawn:${CONTROLLER_FQN}`, 'canonical controller spawn allowed');
      return { kind: 'allow' };
    }
    return {
      kind: 'deny',
      reason:
        `FIRST_ACTIONS_GUARD: required first actions are pending. Only update_plan, ` +
        `WORKFLOW_METHOD_GATE, CAPABILITY_GATE, spawn_agent with PIPELINE_AGENT_FQN: ${CONTROLLER_FQN}, ` +
        `and wait_agent may run before the controller bootstrap is complete. ` +
        `Do not stop or switch to manual fallback; redirect immediately to the canonical controller bootstrap sequence.`,
      attempted: typeof identity === 'string' && identity ? identity : toolName,
      expected: CONTROLLER_FQN,
    };
  }

  if (['Agent', 'Skill'].includes(toolName)) {
    return {
      kind: 'deny',
      reason:
        `FIRST_ACTIONS_GUARD: required first actions are pending. ${toolName} is not allowed before ` +
        `the canonical pipeline-controller spawn/wait sequence completes. ` +
        `Do not stop or switch to manual fallback; redirect immediately to the canonical controller bootstrap sequence.`,
      attempted: toolName,
      expected: CONTROLLER_FQN,
    };
  }

  return undefined;
}

function extractFrontmatterBlock(raw) {
  if (typeof raw !== 'string') return undefined;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : undefined;
}

function parseFrontmatterScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatterValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(parseFrontmatterScalar)
      .filter(Boolean);
  }
  return parseFrontmatterScalar(trimmed);
}

function parseFrontmatterYaml(raw) {
  if (typeof raw !== 'string') return undefined;
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1]] = parseFrontmatterValue(match[2] || '');
  }
  return frontmatter;
}

function loadTrustedSkillFrontmatter(skillName) {
  if (!skillName) return undefined;
  const leaf = skillName.includes(':') ? skillName.split(':').pop() : skillName;
  const roots = [
    process.env.PLUGIN_ROOT,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter((entry) => typeof entry === 'string' && entry.length > 0);

  for (const root of roots) {
    const candidate = path.join(root, 'skills', leaf, 'SKILL.md');
    try {
      const block = extractFrontmatterBlock(fs.readFileSync(candidate, 'utf8'));
      if (block) return parseFrontmatterYaml(block);
    } catch {
      // Try the next trusted root.
    }
  }

  return undefined;
}

function resolveSkillFrontmatter(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  if (toolInput.frontmatter && typeof toolInput.frontmatter === 'object') {
    return toolInput.frontmatter;
  }
  if (typeof toolInput.frontmatter === 'string') {
    return parseFrontmatterYaml(toolInput.frontmatter);
  }
  const content = toolInput.content || toolInput.skill_content || toolInput.skillContent;
  const block = extractFrontmatterBlock(content);
  if (block) {
    return parseFrontmatterYaml(block);
  }
  return loadTrustedSkillFrontmatter(toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name);
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => (typeof entry === 'string' || typeof entry === 'number') && String(entry).trim().length > 0)
      .map((entry) => String(entry).trim());
  }
  if ((typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0) {
    return [String(value).trim()];
  }
  return [];
}

function isAllowedGateToken(entry) {
  return ALLOWED_GATES_AT.has(entry) || /^\d+$/.test(entry);
}

function isAllowedSentinelCheckpoint(entry) {
  return ALLOWED_SENTINEL_CHECKPOINTS.has(entry) || /^pre_\d+$/.test(entry) || /^post_[a-z0-9_-]+$/i.test(entry);
}

function validateSkillFrontmatter(toolInput) {
  const leaf = skillLeafName(toolInput);
  if (!GOVERNED_SKILLS.has(leaf)) {
    return { kind: 'allow' };
  }

  const frontmatter = loadTrustedSkillFrontmatter(leaf);
  if (!frontmatter) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: governed skill "${leaf}" is missing required frontmatter.`,
      attempted: leaf,
      expected: 'agent_type,gates_at,sentinel_checkpoints',
    };
  }

  const agentType = frontmatter.agent_type;
  const disableModelInvocation = frontmatter['disable-model-invocation'];
  const hasValidAgentType = typeof agentType === 'string' && ALLOWED_AGENT_TYPES.has(agentType.trim());
  const isManualOnlySkill = disableModelInvocation === true || disableModelInvocation === 'true';

  if (!hasValidAgentType && !isManualOnlySkill) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter must declare agent_type (${Array.from(ALLOWED_AGENT_TYPES).join(', ')}) or disable-model-invocation: true.`,
      attempted: leaf,
      expected: 'agent_type|disable-model-invocation',
    };
  }

  const gatesAt = asStringArray(frontmatter.gates_at);
  if (gatesAt.length === 0 || gatesAt.some((entry) => !isAllowedGateToken(entry))) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter gates_at must use known phases or numeric step gates.`,
      attempted: leaf,
      expected: 'gates_at',
    };
  }

  const sentinelCheckpoints = asStringArray(frontmatter.sentinel_checkpoints);
  if (sentinelCheckpoints.length === 0 || sentinelCheckpoints.some((entry) => !isAllowedSentinelCheckpoint(entry))) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: skill frontmatter sentinel_checkpoints must use known checkpoints or step checkpoints like pre_3.`,
      attempted: leaf,
      expected: 'sentinel_checkpoints',
    };
  }

  recordHookEvent({
    hook: 'dispatch-guard',
    event: 'PreToolUse',
    decision: 'allow',
    attempted: leaf,
    expected: 'agent_type,gates_at,sentinel_checkpoints',
    reason: 'frontmatter contract valid',
  });
  return { kind: 'allow' };
}

function extractPipelineAgentType(toolInput, options = {}) {
  if (!toolInput || typeof toolInput !== 'object') return '';

  const message = toolInput.message || toolInput.prompt || toolInput.description;
  if (typeof message === 'string') {
    const marker = message.match(/\bPIPELINE_AGENT_FQN:\s*([^\s\r\n]+)/u);
    if (marker?.[1]) return marker[1].trim();
  }

  const hostAgentType = toolInput.agent_type || toolInput.agentType;
  if (hostAgentType !== undefined && hostAgentType !== null) {
    if (typeof hostAgentType !== 'string') {
      return { invalid: true, value: hostAgentType };
    }
    const leaf = hostAgentType.includes(':') ? hostAgentType.split(':').pop() : hostAgentType;
    if (
      hostAgentType.startsWith(`${PIPELINE_NAMESPACE}:`) ||
      hostAgentType.startsWith(`${LEGACY_PIPELINE_NAMESPACE}:`) ||
      isPipelineAgentLeaf(leaf)
    ) {
      if (options.requireMarker) {
        return { markerMissing: true, value: hostAgentType };
      }
      return hostAgentType;
    }
  }

  const direct = toolInput.subagent_type || toolInput.subagentType || toolInput.target_name || toolInput.targetName;
  if (direct !== undefined && direct !== null) {
    if (typeof direct !== 'string') {
      return { invalid: true, value: direct };
    }
    if (options.requireMarker) {
      const leaf = direct.includes(':') ? direct.split(':').pop() : direct;
      if (
        direct.startsWith(`${PIPELINE_NAMESPACE}:`) ||
        direct.startsWith(`${LEGACY_PIPELINE_NAMESPACE}:`) ||
        isPipelineAgentLeaf(leaf)
      ) {
        return { markerMissing: true, value: direct };
      }
      return '';
    }
    return direct;
  }

  return '';
}

function evaluateAgent(toolInput, options = {}) {
  const subagentType = extractPipelineAgentType(toolInput, options);
  if (subagentType && typeof subagentType === 'object' && subagentType.invalid) {
    return {
      kind: 'deny',
      reason: "DISPATCH_GUARD: pipeline agent identity must be a string.",
      attempted: String(subagentType.value),
      expected: "string agent identity",
    };
  }
  if (subagentType && typeof subagentType === 'object' && subagentType.markerMissing) {
    return {
      kind: 'deny',
      reason:
        `DISPATCH_GUARD: Codex spawn_agent pipeline dispatch must use agent_type "worker" and put the canonical FQN in ` +
        `the message as "PIPELINE_AGENT_FQN: <fqn>". Direct pipeline identity fields are not enough.`,
      attempted: String(subagentType.value),
      expected: "PIPELINE_AGENT_FQN marker in message",
    };
  }
  if (!subagentType) return { kind: 'allow' };

  if (subagentType.startsWith(`${LEGACY_PIPELINE_NAMESPACE}:`)) {
    return {
      kind: 'deny',
      reason: `DISPATCH_GUARD: legacy namespace "${LEGACY_PIPELINE_NAMESPACE}" is not allowed. Use ${PIPELINE_NAMESPACE}.`,
      attempted: subagentType,
      expected: PIPELINE_NAMESPACE,
    };
  }

  if (subagentType.startsWith(`${PIPELINE_NAMESPACE}:`)) {
    const segments = subagentType.split(':');
    const leaf = segments.pop();
    if (!isPipelineAgentLeaf(leaf)) {
      return {
        kind: 'deny',
        reason:
          `DISPATCH_GUARD: pipeline agent identity "${subagentType}" uses the pipeline namespace ` +
          `but its leaf "${leaf}" is not a registered pipeline agent.`,
        attempted: subagentType,
      };
    }
    const expectedFqn = fqnFor(leaf);
    if (subagentType !== expectedFqn) {
      return {
        kind: 'deny',
        reason:
          `DISPATCH_GUARD: pipeline agent identity "${subagentType}" is not the expected canonical FQN. ` +
          `Use "${expectedFqn}".`,
        attempted: subagentType,
        expected: expectedFqn,
      };
    }
    return { kind: 'allow' };
  }

  if (isPipelineAgentLeaf(subagentType)) {
    return {
      kind: 'deny',
      reason:
        `DISPATCH_GUARD: pipeline agent identity "${subagentType}" is missing the namespace. ` +
        `Use spawn_agent with PIPELINE_AGENT_FQN: ${fqnFor(subagentType)} instead.`,
      attempted: subagentType,
      expected: fqnFor(subagentType),
    };
  }

  return { kind: 'allow' };
}

function evaluateSkill(toolInput) {
  const frontmatterVerdict = validateSkillFrontmatter(toolInput);
  if (frontmatterVerdict.kind === 'deny') {
    return frontmatterVerdict;
  }

  const skillName = (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName || toolInput.name)) || '';
  if (!skillName) return { kind: 'allow' };
  const leaf = skillName.includes(':') ? skillName.split(':').pop() : skillName;
  if (isPipelineAgentLeaf(leaf)) {
    return {
      kind: 'deny',
      reason:
        `DISPATCH_GUARD: Skill "${skillName}" maps to pipeline agent "${leaf}". ` +
        `Pipeline agents must be spawned via spawn_agent with ` +
        `PIPELINE_AGENT_FQN: ${fqnFor(leaf)}, not via Skill.`,
      attempted: skillName,
      expected: fqnFor(leaf),
    };
  }
  return { kind: 'allow' };
}

function handle(input) {
  const toolName = (input && (input.tool_name || input.toolName)) || '';
  const toolInput = (input && (input.tool_input || input.toolInput)) || {};
  const hookEventName = (input && (input.hook_event_name || input.hookEventName)) || 'PreToolUse';

  let verdict = { kind: 'allow' };

  if (hookEventName === 'PostToolUse') {
    activeFirstActionsPostTool(input, toolName, toolInput);
    return;
  }

  const firstActionsVerdict = activeFirstActionsPreTool(toolName, toolInput);
  if (firstActionsVerdict?.kind === 'deny') {
    deny(firstActionsVerdict.reason, firstActionsVerdict.attempted, firstActionsVerdict.expected);
    return;
  }
  if (firstActionsVerdict?.kind === 'allow') return;

  if (toolName === 'Agent' || toolName === 'spawn_agent') {
    verdict = evaluateAgent(toolInput, { requireMarker: toolName === 'spawn_agent' });
  } else if (toolName === 'Skill') {
    verdict = evaluateSkill(toolInput);
  } else {
    // Be tolerant: hosts may pass empty tool_name. Try both detectors.
    if (toolInput && (toolInput.subagent_type || toolInput.subagentType || toolInput.message || toolInput.prompt)) {
      verdict = evaluateAgent(toolInput);
    } else if (toolInput && (toolInput.skill || toolInput.skill_name || toolInput.skillName)) {
      verdict = evaluateSkill(toolInput);
    }
  }

  if (verdict.kind === 'deny') {
    deny(verdict.reason, verdict.attempted, verdict.expected);
    return;
  }
  allow();
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  // Spec: pipeline-trust-restoration / R11 AC 11.1, 11.4 — fail-closed deny
  // with a sanitized canonical reason. Raw exception messages, paths, and
  // payloads MUST stay out of the user-visible reason (avoid secret leak).
  // The detailed error is forwarded to stderr (operator log) and to the
  // structured hook-event record only.
  const SANITIZED_REASON = 'hook internal error — failing closed';

  let parsed = {};
  const raw = (buffer || '').trim();
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // R11 — malformed stdin payload is treated as an internal-error path.
      process.stderr.write(
        `[dispatch-guard] malformed stdin JSON: ${parseErr && parseErr.message ? parseErr.message : String(parseErr)}\n`,
      );
      recordHookEvent({
        hook: 'dispatch-guard',
        event: 'PreToolUse',
        decision: 'deny',
        reason: 'malformed stdin JSON',
      });
      deny(SANITIZED_REASON);
      return;
    }
  }
  try {
    handle(parsed);
  } catch (err) {
    process.stderr.write(
      `[dispatch-guard] internal error: ${err && err.message ? err.message : String(err)}\n`,
    );
    recordHookEvent({
      hook: 'dispatch-guard',
      event: 'PreToolUse',
      decision: 'deny',
      reason: 'hook crash',
    });
    deny(SANITIZED_REASON);
  }
});
