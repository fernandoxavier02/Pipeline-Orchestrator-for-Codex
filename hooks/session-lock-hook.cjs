#!/usr/bin/env node
'use strict';

/**
 * session-lock-hook.cjs — SessionStart guard for pipeline-orchestrator-for-codex.
 *
 * Enforces a single active pipeline session per workspace.
 *   .codex/pipeline/session-lock.json
 *
 * Source semantics (SessionStart payload `source` field):
 *   - "startup" : a fresh CLI invocation. Active lock => block.
 *   - "resume"  : continuation of an existing session. Active lock => permit; expired => refresh.
 *   - "clear"   : user explicitly cleared the session. Always remove the lock.
 *
 * Output contract (Codex SessionStart hook):
 *   { decision: "block" | null, reason?: string, continue?: true, systemMessage?: string }
 *
 * Atomic writes (Windows-safe): write `.tmp`, unlink target if present, rename.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordHookEvent } = require('./hook-events.cjs');

const DEFAULT_TTL_SECONDS = 60 * 60;
const LOCK_DIR = path.join(process.cwd(), '.codex', 'pipeline');
const LOCK_PATH = path.join(LOCK_DIR, 'session-lock.json');

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return null;
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.session_id !== 'string' ||
      typeof parsed.created_at !== 'number' ||
      typeof parsed.expires_at !== 'number' ||
      (parsed.status !== 'active' && parsed.status !== 'expired')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLockAtomic(lock) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const tmp = `${LOCK_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lock), 'utf8');
  try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* ignore: missing target */ }
  fs.renameSync(tmp, LOCK_PATH);
}

function deleteLock() {
  try {
    fs.unlinkSync(LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

function isExpired(lock, now) {
  return lock.expires_at <= now;
}

function buildLock(sessionId, now, ttlSeconds) {
  return {
    session_id: sessionId,
    created_at: now,
    expires_at: now + ttlSeconds,
    status: 'active',
  };
}

function newSessionId() {
  return `codex-${crypto.randomBytes(6).toString('hex')}`;
}

function emit(output) {
  console.log(JSON.stringify(output));
}

function handle(input) {
  const source = (input && input.source) || 'startup';
  const incomingSessionId = (input && input.session_id) || newSessionId();
  const ttlOverride = Number((input && input.ttl_seconds) || process.env.PIPELINE_SESSION_LOCK_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : DEFAULT_TTL_SECONDS;
  const now = nowEpochSeconds();

  if (source === 'clear') {
    const removed = deleteLock();
    recordHookEvent({
      hook: 'session-lock',
      event: 'SessionStart',
      decision: removed ? 'clear-removed' : 'clear-noop',
      reason: 'session cleared',
    });
    emit({ continue: true });
    return;
  }

  const existing = readLock();

  if (source === 'resume') {
    if (existing && !isExpired(existing, now)) {
      recordHookEvent({
        hook: 'session-lock',
        event: 'SessionStart',
        decision: 'resume-allow',
        attempted: incomingSessionId,
        expected: existing.session_id,
        reason: 'resume with active lock',
      });
      emit({ continue: true });
      return;
    }
    const refreshed = buildLock(existing ? existing.session_id : incomingSessionId, now, ttlSeconds);
    writeLockAtomic(refreshed);
    recordHookEvent({
      hook: 'session-lock',
      event: 'SessionStart',
      decision: existing ? 'resume-refresh-expired' : 'resume-no-lock',
      attempted: refreshed.session_id,
      reason: 'resume refresh',
    });
    emit({ continue: true });
    return;
  }

  // startup
  if (existing && !isExpired(existing, now)) {
    const reason =
      `Pipeline session-lock is ACTIVE for session_id=${existing.session_id} ` +
      `(expires_at=${existing.expires_at}). Concurrent pipeline executions are not permitted. ` +
      `Wait for the active session to finish, or run with source=clear to release the lock.`;
    recordHookEvent({
      hook: 'session-lock',
      event: 'SessionStart',
      decision: 'block',
      attempted: incomingSessionId,
      expected: existing.session_id,
      reason: 'concurrent session',
    });
    emit({ decision: 'block', reason, continue: true });
    return;
  }

  const fresh = buildLock(incomingSessionId, now, ttlSeconds);
  writeLockAtomic(fresh);
  recordHookEvent({
    hook: 'session-lock',
    event: 'SessionStart',
    decision: existing ? 'startup-replaced-expired' : 'startup-fresh',
    attempted: fresh.session_id,
    reason: 'lock acquired',
  });
  emit({ continue: true });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  let parsed = {};
  const raw = (buffer || '').trim();
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  try {
    handle(parsed);
  } catch (err) {
    // Fail-closed on unexpected error
    recordHookEvent({
      hook: 'session-lock',
      event: 'SessionStart',
      decision: 'block',
      reason: `hook crash: ${err && err.message ? err.message : String(err)}`,
    });
    emit({
      decision: 'block',
      reason: `session-lock-hook crashed: ${err && err.message ? err.message : 'unknown error'}`,
      continue: true,
    });
  }
});
