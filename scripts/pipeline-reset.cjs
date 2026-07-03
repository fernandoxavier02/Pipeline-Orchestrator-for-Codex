#!/usr/bin/env node
'use strict';

/**
 * pipeline-reset.cjs — deterministic escape route out of a stuck pipeline.
 *
 * Deletes ONLY the canonical pipeline session/obligation state under
 * <cwd>/.codex/pipeline so a wedged run (tampered/expired state, pending
 * first-actions, orphaned exec-window) can be recovered without touching
 * audit ledgers.
 *
 * Removes (exactly):
 *   .codex/pipeline/workflow-intent.json
 *   .codex/pipeline/required-first-actions.json
 *   .codex/pipeline/sentinel-state.json
 *   .codex/pipeline/session-lock.json
 *   .codex/pipeline/session.json
 *   .codex/pipeline/sessions/*.exec-window
 *
 * NEVER touches ledgers/audit: hook-events.jsonl, gate-decisions.jsonl,
 * confidence-score.yaml, fidelity-reports/, change-contract.json,
 * pipeline-archives/, or anything else.
 *
 * Output (stdout JSON): { status: "RESET", removed: string[], skipped: string[] }
 * On symlink-escape / traversal: refuses (stderr + non-zero exit), deletes nothing.
 *
 * CJS, Node builtins only.
 */

const fs = require('fs');
const path = require('path');
const { realpathOfExistingAncestor } = require('../hooks/path-safety.cjs');

const PIPELINE_STATE_FILES = [
  'workflow-intent.json',
  'required-first-actions.json',
  'sentinel-state.json',
  'session-lock.json',
  'session.json',
];
const EXEC_WINDOW_SUFFIX = '.exec-window';

function recordResetEvent(event) {
  try {
    // Silent fallback: observability must never block recovery.
    const { recordHookEvent } = require('../hooks/hook-events.cjs');
    recordHookEvent(event);
  } catch {
    // ignore — hook-events module unavailable or failed.
  }
}

function isWithin(parentReal, childReal) {
  const rel = path.relative(parentReal, childReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// realpathOfExistingAncestor lives in hooks/path-safety.cjs (shared with
// edit-guard-hook.cjs); it returns null when nothing along the chain resolves,
// and this caller refuses on null (fail-closed).

// F6: a directory is safe to operate on only if its realpath (following any
// intermediate symlinks like `.codex -> /external`) stays under the real cwd.
function safeDescendantDir(cwdReal, dir) {
  const real = realpathOfExistingAncestor(dir);
  if (real === null) return null;
  return isWithin(cwdReal, real) ? real : undefined; // undefined = escapes cwd
}

function refuse(reason) {
  recordResetEvent({
    hook: 'pipeline-reset',
    event: 'pipeline_reset',
    decision: 'refused',
    attempted: 'pipeline-reset',
    reason,
  });
  process.stderr.write(`pipeline-reset: ${reason}\n`);
  process.exit(1);
}

// Delete a single expected target. Anti-symlink: lstat before unlink so a
// symlink planted at a state path is never followed. Path-traversal: the
// resolved parent must remain the pipeline dir.
function removeTarget(pipelineDirReal, target, relLabel, removed, skipped) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return; // absent — nothing to remove, not an error.
  }
  if (stat.isSymbolicLink()) {
    skipped.push(relLabel);
    return;
  }
  const parentReal = realpathOfExistingAncestor(path.dirname(target));
  if (parentReal === null || !isWithin(pipelineDirReal, parentReal)) {
    skipped.push(relLabel);
    return;
  }
  try {
    fs.unlinkSync(target);
    removed.push(relLabel);
  } catch {
    skipped.push(relLabel);
  }
}

function handle() {
  const cwd = process.cwd();
  let cwdReal;
  try {
    cwdReal = fs.realpathSync(cwd);
  } catch {
    cwdReal = path.resolve(cwd);
  }

  const pipelineDir = path.join(cwd, '.codex', 'pipeline');

  recordResetEvent({
    hook: 'pipeline-reset',
    event: 'pipeline_reset',
    decision: 'start',
    attempted: 'pipeline-reset',
    reason: 'resetting canonical pipeline state',
  });

  const pipelineDirReal = safeDescendantDir(cwdReal, pipelineDir);
  if (pipelineDirReal === undefined) {
    refuse('.codex/pipeline resolves outside the working directory (symlink escape)');
  }
  if (pipelineDirReal === null) {
    // Cannot resolve any ancestor — nothing to reset.
    emitResult([], []);
    return;
  }

  const removed = [];
  const skipped = [];

  for (const name of PIPELINE_STATE_FILES) {
    removeTarget(pipelineDirReal, path.join(pipelineDir, name), name, removed, skipped);
  }

  const sessionsDir = path.join(pipelineDir, 'sessions');
  const sessionsReal = safeDescendantDir(cwdReal, sessionsDir);
  if (sessionsReal === undefined) {
    refuse('.codex/pipeline/sessions resolves outside the working directory (symlink escape)');
  }
  let entries = [];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.endsWith(EXEC_WINDOW_SUFFIX)) continue;
    removeTarget(
      sessionsReal || pipelineDirReal,
      path.join(sessionsDir, entry),
      `sessions/${entry}`,
      removed,
      skipped,
    );
  }

  emitResult(removed, skipped);
}

function emitResult(removed, skipped) {
  recordResetEvent({
    hook: 'pipeline-reset',
    event: 'pipeline_reset',
    decision: 'RESET',
    attempted: 'pipeline-reset',
    reason: `removed=${removed.length} skipped=${skipped.length}`,
  });
  console.log(JSON.stringify({ status: 'RESET', removed, skipped }));
}

if (require.main === module) {
  // Input is ignored; drain any piped stdin so callers do not hang, then reset.
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    handle();
  };
  if (process.stdin.isTTY) {
    run(); // no pipe — `end` would never fire.
  } else {
    process.stdin.on('data', () => {});
    process.stdin.on('end', run);
    process.stdin.on('error', run);
  }
}

module.exports = {
  handle,
  removeTarget,
  safeDescendantDir,
  realpathOfExistingAncestor,
  PIPELINE_STATE_FILES,
};
