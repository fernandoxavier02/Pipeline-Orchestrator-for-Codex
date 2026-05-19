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

// Spec: pipeline-trust-restoration / R13 — Exec Window Resists Symlink Attack.
// lstat the target before any rename/write. If the target is a symbolic link,
// throw `SymlinkRefusedError` with a structured `err.code` and emit an audit
// entry to stderr. Callers (writeWindowAtomic) MUST invoke this before
// rename/write so a pre-created symlink at the target path cannot be exploited
// to overwrite arbitrary files outside .codex/pipeline/sessions/.
//
// `lstatFn` parameter (post-review C4): the production caller does not pass
// it (defaults to fs.lstatSync). Tests inject their own implementation to
// exercise the symlink-refused branch cross-platform without needing OS-level
// symlink creation primitives — see tests/unit/exec-window-symlink.test.ts.
function rejectSymlink(targetPath, lstatFn = fs.lstatSync) {
  try {
    const stat = lstatFn(targetPath);
    if (stat.isSymbolicLink()) {
      const err = new Error(
        `SymlinkRefusedError: refusing to write over symbolic link at ${targetPath}`,
      );
      err.code = 'SYMLINK_REFUSED';
      // R13 AC 13.3 — audit the abort (stderr is the operator log channel).
      process.stderr.write(
        `[exec-window/open] symlink-refused target=${targetPath}\n`,
      );
      throw err;
    }
  } catch (err) {
    if (err && err.code === 'SYMLINK_REFUSED') throw err;
    // File doesn't exist (ENOENT) → harmless, fall through.
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
  // Post-review fix (QUAL-004): single TTL boundary check. The previous
  // version had a second `if (ttl > MAX_TTL)` after the bounds-bound
  // assignment, which was unreachable (the first check exits the process if
  // ttlInput > MAX_TTL, and ttl is bounded to ttlInput or DEFAULT_TTL).
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

// Only attach the stdin listener when invoked as a script (not when
// require()'d by tests). Tests import { rejectSymlink } directly to exercise
// the symlink guard cross-platform without needing the OS-level symlink
// creation primitives (post-review fix C4).
if (require.main === module) {
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
}

module.exports = {
  rejectSymlink,
  writeWindowAtomic,
  execWindowPath,
  encodeSessionId,
};
