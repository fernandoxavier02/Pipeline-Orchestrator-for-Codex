#!/usr/bin/env node
'use strict';

/**
 * exec-window/close.cjs — Fecha uma exec-window e registra audit log
 *
 * Input (stdin JSON):
 *   { session_id: string }
 *
 * Output (stdout JSON):
 *   { status: "CLOSED", session_id }
 *
 * Actions:
 *   - Verifica se exec-window existe e está OPEN
 *   - Remove arquivo .exec-window
 *   - Appends EXEC_WINDOW_CLOSE em gate-decisions.jsonl
 */

const fs = require('fs');
const path = require('path');

function encodeSessionId(sessionId) {
  return `session-${Buffer.from(sessionId, 'utf8').toString('base64url')}`;
}

function execWindowPath(cwd, sessionId) {
  return path.join(cwd, '.codex', 'pipeline', 'sessions', `${encodeSessionId(sessionId)}.exec-window`);
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readWindow(windowPath) {
  try {
    if (!fs.existsSync(windowPath)) return null;
    return JSON.parse(fs.readFileSync(windowPath, 'utf8'));
  } catch {
    return null;
  }
}

function gateLogPath(cwd) {
  return path.join(cwd, '.codex', 'pipeline', 'gate-decisions.jsonl');
}

function appendGateLog(cwd, entry) {
  const p = gateLogPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(p, line, 'utf8');
}

function emit(output) {
  console.log(JSON.stringify(output));
}

function emitError(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function rejectSymlink(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      emitError(`SECURITY: ${targetPath} is a symbolic link. Refusing to operate.`);
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith('SECURITY:')) throw err;
    // File doesn't exist — that's fine
  }
}

function handle(input) {
  const sessionId = input && input.session_id;
  const now = nowEpochSeconds();

  if (!sessionId || typeof sessionId !== 'string') {
    emitError('close.cjs: session_id is required (string)');
  }

  const windowPath = execWindowPath(process.cwd(), sessionId);
  rejectSymlink(windowPath);

  const existing = readWindow(windowPath);

  if (!existing) {
    emitError(`close.cjs: exec-window for session_id=${sessionId} is not OPEN (file missing)`);
  }

  if (existing.expires_at <= now) {
    // Window is expired — still remove it, but report error
    try { fs.unlinkSync(windowPath); } catch (_) {}
    emitError(`close.cjs: exec-window for session_id=${sessionId} is EXPIRED (expires_at=${existing.expires_at})`);
  }

  // Valid OPEN window — close it
  try {
    fs.unlinkSync(windowPath);
  } catch (err) {
    emitError(`close.cjs: failed to remove exec-window: ${err.message}`);
  }

  appendGateLog(process.cwd(), {
    gate: 'EXEC_WINDOW_CLOSE',
    hardness: 'HARD',
    phase: 'phase-2',
    decision: 'pass',
    decided_by: 'controller',
    timestamp: new Date().toISOString(),
    detail: `exec-window closed for session=${sessionId}`,
    confidence_impact: 0,
    session_id: sessionId,
    opened_at: existing.opened_at,
    closed_at: now,
  });

  emit({
    status: 'CLOSED',
    session_id: sessionId,
    closed_at: now,
  });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  let parsed = {};
  const raw = (buffer || '').trim();
  if (raw) {
    try { parsed = JSON.parse(raw); } catch {
      emitError('close.cjs: malformed JSON on stdin');
    }
  }
  handle(parsed);
});
