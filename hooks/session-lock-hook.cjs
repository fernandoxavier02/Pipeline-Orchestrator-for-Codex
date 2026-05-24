#!/usr/bin/env node
'use strict';

/**
 * session-lock-hook.cjs — Session lock guard + heartbeat for pipeline-orchestrator-for-codex.
 *
 * Enforces a single active pipeline session per workspace.
 *   .codex/pipeline/session-lock.json
 *
 * Supports TWO event modes:
 *   1. SessionStart (source field present):
 *      - "startup" : a fresh CLI invocation. Active lock => block.
 *      - "resume"  : continuation of an existing session. Active lock => permit; expired => refresh.
 *      - "clear"   : user explicitly cleared the session. Always remove the lock.
 *   2. UserPromptSubmit (event field === "UserPromptSubmit"):
 *      - Heartbeat: updates last_seen_at and refreshes expires_at.
 *      - GC: removes expired locks.
 *
 * Output contract (Codex hook):
 *   allow: { continue: true }
 *   block: { continue: false, stopReason: string, systemMessage: string }
 *
 * Atomic writes (Windows-safe): write `.tmp`, unlink target if present, rename.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recordHookEvent } = require('./hook-events.cjs');

const DEFAULT_TTL_SECONDS = 60 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60; // 24 hours cap
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

function rejectSymlink(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`SECURITY: ${targetPath} is a symbolic link. Refusing to write.`);
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith('SECURITY:')) throw err;
    // File doesn't exist — that's fine
  }
}

function writeLockAtomic(lock) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  rejectSymlink(LOCK_PATH);
  rejectSymlink(`${LOCK_PATH}.tmp`);
  const tmp = `${LOCK_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lock), 'utf8');
  // Node.js renameSync on Windows overwrites existing files since Node v6.
  // Skip unlinkSync to avoid non-atomic window.
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

function emitBlock(reason) {
  emit({
    continue: false,
    stopReason: reason,
    systemMessage: reason,
  });
}

function handleHeartbeat(input) {
  const now = nowEpochSeconds();
  const existing = readLock();

  if (!existing) {
    // No lock to heartbeat — silent no-op
    return;
  }

  if (isExpired(existing, now)) {
    deleteLock();
    recordHookEvent({
      hook: 'session-lock',
      event: 'UserPromptSubmit',
      decision: 'heartbeat-removed-expired',
      reason: 'lock expired during heartbeat',
    });
    return;
  }

  const ttlOverride = Number((input && input.ttl_seconds) || process.env.PIPELINE_SESSION_LOCK_TTL_SECONDS);
  const ttlSeconds = Math.min(
    Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : DEFAULT_TTL_SECONDS,
    MAX_TTL_SECONDS
  );

  const refreshed = {
    ...existing,
    last_seen_at: now,
    expires_at: now + ttlSeconds,
    status: 'active',
  };
  writeLockAtomic(refreshed);
  recordHookEvent({
    hook: 'session-lock',
    event: 'UserPromptSubmit',
    decision: 'heartbeat-updated',
    attempted: existing.session_id,
    reason: 'last_seen_at updated, expires_at refreshed',
  });
}

function handleSessionStart(input) {
  const source = (input && input.source) || 'startup';
  const incomingSessionId = (input && input.session_id) || newSessionId();
  const ttlOverride = Number((input && input.ttl_seconds) || process.env.PIPELINE_SESSION_LOCK_TTL_SECONDS);
  const ttlSeconds = Math.min(
    Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : DEFAULT_TTL_SECONDS,
    MAX_TTL_SECONDS
  );
  const now = nowEpochSeconds();

  if (source === 'clear') {
    // Authenticated clear: require matching session_id of active lock
    const existing = readLock();
    const providedSessionId = input && input.session_id;
    if (existing && existing.session_id !== providedSessionId) {
      recordHookEvent({
        hook: 'session-lock',
        event: 'SessionStart',
        decision: 'deny',
        attempted: providedSessionId,
        expected: existing.session_id,
        reason: 'clear rejected: provided session_id does not match active lock',
      });
      emitBlock(`session-lock clear rejected: provided session_id does not match active lock (${existing.session_id}).`);
      return;
    }
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
    if (existing.session_id === incomingSessionId) {
      recordHookEvent({
        hook: 'session-lock',
        event: 'SessionStart',
        decision: 'startup-idempotent',
        attempted: incomingSessionId,
        expected: existing.session_id,
        reason: 'startup repeated for active session',
      });
      emit({ continue: true });
      return;
    }

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
    emitBlock(reason);
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

function handle(input) {
  const event = (input && input.event) || 'SessionStart';
  if (event === 'UserPromptSubmit') {
    handleHeartbeat(input);
    return;
  }
  handleSessionStart(input);
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
    emitBlock(`session-lock-hook crashed: ${err && err.message ? err.message : 'unknown error'}`);
  }
});
