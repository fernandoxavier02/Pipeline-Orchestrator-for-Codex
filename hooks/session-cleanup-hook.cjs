#!/usr/bin/env node
'use strict';

/**
 * session-cleanup-hook.cjs — Stop hook for pipeline-orchestrator-for-codex.
 *
 * Cleans up workspace state after a pipeline session ends:
 *   - Removes expired session-lock (.codex/pipeline/session-lock.json).
 *   - Sweeps expired exec-window files
 *     (.codex/pipeline/sessions/*.exec-window).
 *
 * Output contract (Codex Stop hook):
 *   { decision: null, continue: true, systemMessage?: string }
 *
 * Never blocks the pipeline; failures are logged via hook-events but
 * do not propagate.
 */

const fs = require('fs');
const path = require('path');
const { recordHookEvent } = require('./hook-events.cjs');

const PIPELINE_DIR = path.join(process.cwd(), '.codex', 'pipeline');
const SESSION_LOCK_PATH = path.join(PIPELINE_DIR, 'session-lock.json');
const WORKFLOW_INTENT_PATH = path.join(PIPELINE_DIR, 'workflow-intent.json');
const REQUIRED_FIRST_ACTIONS_PATH = path.join(PIPELINE_DIR, 'required-first-actions.json');
const SENTINEL_PATH = path.join(PIPELINE_DIR, 'sentinel-state.json');
const SESSION_PATH = path.join(PIPELINE_DIR, 'session.json');
const SESSIONS_DIR = path.join(PIPELINE_DIR, 'sessions');
const EXEC_WINDOW_SUFFIX = '.exec-window';
const FIDELITY_REPORTS_DIR = path.join(PIPELINE_DIR, 'fidelity-reports');
const STALE_BLOCKED_RUNTIME_MS = 300_000;

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function pipelineDirectoryIsSafe() {
  const cwd = process.cwd();
  const codexDir = path.join(cwd, '.codex');
  for (const candidate of [codexDir, PIPELINE_DIR]) {
    try {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  try {
    if (fs.existsSync(PIPELINE_DIR)) {
      const realCwd = fs.realpathSync(cwd);
      const realPipelineDir = fs.realpathSync(PIPELINE_DIR);
      const relative = path.relative(realCwd, realPipelineDir);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return false;
      }
    }
  } catch {
    return false;
  }

  return true;
}

function isLockExpired(lock, now) {
  return !lock || typeof lock.expires_at !== 'number' || lock.expires_at <= now;
}

function sweepSessionLock(now) {
  if (!fs.existsSync(SESSION_LOCK_PATH)) {
    return { removed: 0, skipped: 0 };
  }
  const lock = readJsonSafe(SESSION_LOCK_PATH);
  if (isLockExpired(lock, now)) {
    try {
      fs.unlinkSync(SESSION_LOCK_PATH);
      return { removed: 1, skipped: 0 };
    } catch {
      return { removed: 0, skipped: 1 };
    }
  }
  return { removed: 0, skipped: 1 };
}

function sweepExpiringStateFile(filePath, now) {
  if (!fs.existsSync(filePath)) {
    return { removed: 0, skipped: 0 };
  }
  const state = readJsonSafe(filePath);
  if (state && typeof state.expires_at === 'number' && state.expires_at <= now) {
    try {
      fs.unlinkSync(filePath);
      return { removed: 1, skipped: 0 };
    } catch {
      return { removed: 0, skipped: 1 };
    }
  }
  return { removed: 0, skipped: 1 };
}

function sweepExpiredSentinel(now) {
  if (!fs.existsSync(SENTINEL_PATH)) {
    return { removed: 0, skipped: 0 };
  }
  const sentinel = readJsonSafe(SENTINEL_PATH);
  if (sentinel && typeof sentinel.expires_at === 'number' && sentinel.expires_at <= now) {
    try {
      fs.unlinkSync(SENTINEL_PATH);
      return { removed: 1, skipped: 0 };
    } catch {
      return { removed: 0, skipped: 1 };
    }
  }
  return { removed: 0, skipped: 1 };
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

function hasActiveStateFile(filePath, now) {
  const state = readJsonSafe(filePath);
  return !!(
    state
    && typeof state === 'object'
    && state.status === 'active'
    && state.plugin === 'pipeline-orchestrator-for-codex'
    && typeof state.expires_at === 'number'
    && state.expires_at > now
  );
}

function hasActivePipelineObligation(now) {
  if (fs.existsSync(SESSION_LOCK_PATH)) {
    const lock = readJsonSafe(SESSION_LOCK_PATH);
    if (lock && lock.status === 'active' && typeof lock.expires_at === 'number' && lock.expires_at > now) {
      return true;
    }
  }
  return hasActiveStateFile(WORKFLOW_INTENT_PATH, now)
    || hasActiveStateFile(REQUIRED_FIRST_ACTIONS_PATH, now);
}

function removeFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return { removed: 0, skipped: 0 };
  try {
    fs.unlinkSync(filePath);
    return { removed: 1, skipped: 0 };
  } catch {
    return { removed: 0, skipped: 1 };
  }
}

function sweepStaleBlockedRuntimeState(now) {
  if (hasActivePipelineObligation(now)) {
    return { removed: 0, skipped: 0 };
  }

  let removed = 0;
  let skipped = 0;
  for (const filePath of [SENTINEL_PATH, SESSION_PATH]) {
    const state = readJsonSafe(filePath);
    const lastTouched = stateLastTouchedMs(state);
    if (
      !isBlockedNoAgentRuntimeState(state)
      || lastTouched <= 0
      || Date.now() - lastTouched <= STALE_BLOCKED_RUNTIME_MS
    ) {
      continue;
    }
    const result = removeFileIfExists(filePath);
    removed += result.removed;
    skipped += result.skipped;
  }
  return { removed, skipped };
}

function sweepExecWindows(now) {
  if (!fs.existsSync(SESSIONS_DIR)) {
    return { removed: 0, skipped: 0, total: 0 };
  }
  let entries;
  try {
    entries = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return { removed: 0, skipped: 0, total: 0 };
  }
  let removed = 0;
  let skipped = 0;
  let total = 0;
  for (const name of entries) {
    if (!name.endsWith(EXEC_WINDOW_SUFFIX)) continue;
    total += 1;
    const filePath = path.join(SESSIONS_DIR, name);
    const window = readJsonSafe(filePath);
    const isExpired = !window || typeof window.expires_at !== 'number' || window.expires_at <= now;
    if (isExpired) {
      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch {
        skipped += 1;
      }
    } else {
      skipped += 1;
    }
  }
  return { removed, skipped, total };
}

function parseHookPayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown-run';
}

function resolveRunId(payload = {}) {
  const candidate = process.env.CODEX_PIPELINE_TRACE_ID
    || process.env.PIPELINE_TRACE_ID
    || process.env.CODEX_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || payload.pipeline_run_id
    || payload.run_id
    || payload.trace_id
    || payload.session_id
    || payload.transcript_id
    || 'unknown-run';

  return safeFilePart(candidate);
}

function ensureSafeReportDir() {
  fs.mkdirSync(PIPELINE_DIR, { recursive: true });
  if (fs.existsSync(FIDELITY_REPORTS_DIR)) {
    const stat = fs.lstatSync(FIDELITY_REPORTS_DIR);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('fidelity reports path must be a real directory');
    }
    return;
  }
  fs.mkdirSync(FIDELITY_REPORTS_DIR, { recursive: false });
}

function writeStopFidelityReport(
  now,
  lockResult,
  workflowIntentResult,
  requiredFirstActionsResult,
  sentinelResult,
  staleBlockedRuntimeResult,
  windowResult,
  payload = {},
) {
  const runId = resolveRunId(payload);
  ensureSafeReportDir();
  const report = {
    report_type: 'stop-hook-fidelity',
    run_id: runId,
    generated_at: new Date(now * 1000).toISOString(),
    hook: 'session-cleanup',
    decision: 'cleanup',
    cleanup: {
      session_lock_removed: lockResult.removed,
      session_lock_skipped: lockResult.skipped,
      workflow_intent_removed: workflowIntentResult.removed,
      workflow_intent_skipped: workflowIntentResult.skipped,
      required_first_actions_removed: requiredFirstActionsResult.removed,
      required_first_actions_skipped: requiredFirstActionsResult.skipped,
      sentinel_removed: sentinelResult.removed,
      sentinel_skipped: sentinelResult.skipped,
      stale_blocked_runtime_removed: staleBlockedRuntimeResult.removed,
      stale_blocked_runtime_skipped: staleBlockedRuntimeResult.skipped,
      exec_windows_removed: windowResult.removed,
      exec_windows_skipped: windowResult.skipped,
      exec_windows_total: windowResult.total,
    },
  };

  try {
    fs.writeFileSync(path.join(FIDELITY_REPORTS_DIR, `${runId}.json`), `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return { created: 1, skipped: 0 };
  } catch {
    return { created: 0, skipped: 1 };
  }
}

function emit(output) {
  console.log(JSON.stringify(output));
}

function handle(rawPayload = '') {
  if (!pipelineDirectoryIsSafe()) {
    emit({ continue: true });
    return;
  }

  const now = nowEpochSeconds();
  const payload = parseHookPayload(rawPayload);
  const lockResult = sweepSessionLock(now);
  const workflowIntentResult = sweepExpiringStateFile(WORKFLOW_INTENT_PATH, now);
  const requiredFirstActionsResult = sweepExpiringStateFile(REQUIRED_FIRST_ACTIONS_PATH, now);
  const sentinelResult = sweepExpiredSentinel(now);
  const staleBlockedRuntimeResult = sweepStaleBlockedRuntimeState(now);
  const windowResult = sweepExecWindows(now);
  const fidelityResult = writeStopFidelityReport(
    now,
    lockResult,
    workflowIntentResult,
    requiredFirstActionsResult,
    sentinelResult,
    staleBlockedRuntimeResult,
    windowResult,
    payload,
  );

  recordHookEvent({
    hook: 'session-cleanup',
    event: 'Stop',
    decision: 'cleanup',
    reason: `lock removed=${lockResult.removed}, workflow-intent removed=${workflowIntentResult.removed}, required-first-actions removed=${requiredFirstActionsResult.removed}, sentinel removed=${sentinelResult.removed}, stale-blocked-runtime removed=${staleBlockedRuntimeResult.removed}, exec-windows removed=${windowResult.removed}/${windowResult.total}, fidelity-report created=${fidelityResult.created}`,
  });

  emit({ continue: true });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  try {
    handle(buffer);
  } catch (err) {
    recordHookEvent({
      hook: 'session-cleanup',
      event: 'Stop',
      decision: 'error',
      reason: err && err.message ? err.message : String(err),
    });
    // Never block on error — Stop hooks must allow the session to terminate.
    emit({ continue: true });
  }
});
