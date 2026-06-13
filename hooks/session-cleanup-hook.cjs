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
const SESSIONS_DIR = path.join(PIPELINE_DIR, 'sessions');
const EXEC_WINDOW_SUFFIX = '.exec-window';
const FIDELITY_REPORTS_DIR = path.join(PIPELINE_DIR, 'fidelity-reports');

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

function writeStopFidelityReport(now, lockResult, windowResult, payload = {}) {
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
  const now = nowEpochSeconds();
  const payload = parseHookPayload(rawPayload);
  const lockResult = sweepSessionLock(now);
  const windowResult = sweepExecWindows(now);
  const fidelityResult = writeStopFidelityReport(now, lockResult, windowResult, payload);

  recordHookEvent({
    hook: 'session-cleanup',
    event: 'Stop',
    decision: 'cleanup',
    reason: `lock removed=${lockResult.removed}, exec-windows removed=${windowResult.removed}/${windowResult.total}, fidelity-report created=${fidelityResult.created}`,
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
