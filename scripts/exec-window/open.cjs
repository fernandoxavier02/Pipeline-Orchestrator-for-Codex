#!/usr/bin/env node
'use strict';

/**
 * exec-window/open.cjs — Abre uma exec-window autorizando edições fora de .codex/pipeline/
 *
 * Input (stdin JSON):
 *   { session_id: string, ttl_seconds?: number, purpose: string, spawning_agent: string }
 *
 * Output (stdout JSON):
 *   { status: "OPEN", session_id, expires_at }
 *
 * Writes: .codex/pipeline/sessions/session-<base64url>.exec-window
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TTL = 5 * 60;
const MAX_TTL = 60 * 60;

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

function writeWindowAtomic(windowPath, window) {
  fs.mkdirSync(path.dirname(windowPath), { recursive: true });
  // Security: reject if target or its .tmp sibling is a symlink (TOCTOU protection)
  rejectSymlink(windowPath);
  rejectSymlink(`${windowPath}.tmp`);
  const tmp = `${windowPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(window), 'utf8');
  // Node.js renameSync overwrites existing files on Windows since Node v6;
  // skip unlinkSync to avoid non-atomic window on Windows.
  fs.renameSync(tmp, windowPath);
}

function emit(output) {
  console.log(JSON.stringify(output));
}

function emitError(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function handle(input) {
  const sessionId = input && input.session_id;
  const purpose = input && input.purpose;
  const spawningAgent = input && input.spawning_agent;
  const ttlInput = Number(input && input.ttl_seconds);
  if (ttlInput > MAX_TTL) {
    emitError(`open.cjs: ttl_seconds ${ttlInput} exceeds MAX_TTL=${MAX_TTL}`);
  }
  const ttl = Number.isInteger(ttlInput) && ttlInput > 0 ? ttlInput : DEFAULT_TTL;
  const now = nowEpochSeconds();

  if (!sessionId || typeof sessionId !== 'string') {
    emitError('open.cjs: session_id is required (string)');
  }
  if (!purpose || typeof purpose !== 'string') {
    emitError('open.cjs: purpose is required (string)');
  }
  if (!spawningAgent || typeof spawningAgent !== 'string') {
    emitError('open.cjs: spawning_agent is required (string)');
  }
  if (ttl > MAX_TTL) {
    emitError(`open.cjs: ttl_seconds ${ttl} exceeds MAX_TTL=${MAX_TTL}`);
  }

  const windowPath = execWindowPath(process.cwd(), sessionId);
  const existing = readWindow(windowPath);
  if (existing && existing.expires_at > now) {
    emitError(`open.cjs: exec-window for session_id=${sessionId} is already OPEN (expires_at=${existing.expires_at})`);
  }

  const window = {
    session_id: sessionId,
    opened_at: now,
    expires_at: now + ttl,
    purpose,
    spawning_agent: spawningAgent,
  };

  writeWindowAtomic(windowPath, window);

  emit({
    status: 'OPEN',
    session_id: sessionId,
    expires_at: window.expires_at,
    purpose,
    spawning_agent: spawningAgent,
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
      emitError('open.cjs: malformed JSON on stdin');
    }
  }
  handle(parsed);
});
