#!/usr/bin/env node
'use strict';

/**
 * edit-guard-hook.cjs — PreToolUse:Edit|Write|NotebookEdit|MultiEdit guard
 *
 * Blocks edits outside of .codex/pipeline/ and pipeline-runs/ when a pipeline
 * session is active but no exec-window is OPEN, and always protects canonical
 * .codex/pipeline state files from tool/Bash mutation while the session is active.
 *
 * Input (stdin JSON):
 *   { tool_name: string, tool_input: { file_path: string } }
 *
 * Output (stdout JSON):
 *   {}  — allow (silent)
 *   { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "..." } }
 *
 * Fail mode: fail-closed (crash → deny)
 */

const fs = require('fs');
const path = require('path');
const { recordHookEvent } = require('./hook-events.cjs');
const { stateObjectIntegrityVerified } = require('./ledger-integrity.cjs');

const PROTECTED_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash']);
const PIPELINE_NAMESPACE = 'pipeline-orchestrator-for-codex';
const ALLOWED_PATHS = ['.codex', 'pipeline-runs'];
const PROTECTED_PIPELINE_STATE_FILES = new Set([
  '.codex/pipeline/workflow-intent.json',
  '.codex/pipeline/required-first-actions.json',
  '.codex/pipeline/sentinel-state.json',
  '.codex/pipeline/session-lock.json',
]);
const PROTECTED_PIPELINE_STATE_STEMS = new Set([
  'workflow-intent',
  'required-first-actions',
  'sentinel-state',
  'session-lock',
]);

// Bash command patterns that modify files outside allowed paths.
// Post-review (SEC-007): broadened to cover write primitives the original
// list missed — dd, install, rsync, ln -s, truncate, heredoc, and language
// runtimes that open files for write.
const BASH_FILE_MODIFYING_PATTERNS = [
  // Redirections (zero or more whitespace after operator)
  />[>]?\s*/,
  /\|[\s]*tee\b/,
  // File-modifying commands
  /\b(rm|rmdir|mv|cp|chmod|chown|touch|mkdir)\b/,
  /\bsed\b.*\s-i/,
  /\bawk\b.*>/,
  // SEC-007 additions
  /\bdd\b.*\bof=/,                // dd of=<path>
  /\binstall\b/,                  // install -m 755 src dest
  /\brsync\b.*--delete/,          // rsync --delete dest/
  /\btruncate\b/,                 // truncate -s 0 <path>
  /\bln\b\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*s/, // ln -s, ln -sf, ln -fs
  /<<\s*['"]?[A-Za-z_]/,          // heredoc start (`<< EOF`, `<<'EOF'`, etc.)
  // Language runtimes opening files for write
  /\bpython3?\b.*\bopen\s*\([^)]*['"]w/,
  /\bperl\b.*\bopen\s*\(.*['"]>/,
  /\bnode\b.*\bwriteFileSync/,
];

function bashCommandModifiesFiles(command) {
  if (typeof command !== 'string') return false;
  return BASH_FILE_MODIFYING_PATTERNS.some((re) => re.test(command));
}

function bashCommandMentionsPipelineStateArea(command) {
  return typeof command === 'string'
    && command.replace(/\\/g, '/').toLowerCase().includes('.codex/pipeline');
}

function protectedPipelineStateMentionsInBash(command) {
  if (typeof command !== 'string') return [];
  const normalized = command.replace(/\\/g, '/').toLowerCase();
  if (!normalized.includes('.codex/pipeline/')) return [];
  return [...PROTECTED_PIPELINE_STATE_STEMS]
    .filter((stem) => normalized.includes(stem))
    .map((stem) => `.codex/pipeline/${stem}`);
}

// Extract target file paths from a Bash command (e.g., after >, >>, tee, mv, cp)
function extractBashTargetPaths(command) {
  if (typeof command !== 'string') return [];
  const paths = [];
  // Match redirection targets: echo x > path/to/file  or  echo x >file
  const redirectRe = />[>]?\s*['"]?(.*?)(?:(?=['"])\s|$)/g;
  let m;
  while ((m = redirectRe.exec(command)) !== null) {
    const p = m[1].trim();
    if (p) paths.push(p);
  }
  // Match tee: ... | tee path/to/file
  const teeRe = /\|\s*tee\s+['"]?(.*?)(?:(?=['"])\s|$)/g;
  while ((m = teeRe.exec(command)) !== null) {
    const p = m[1].trim();
    if (p) paths.push(p);
  }
  // Match mv/cp source dest
  const mvRe = /\b(?:mv|cp)\s+(?:-[a-zA-Z]+\s+)?['"]?(\S+?)['"]?\s+['"]?(\S+?)['"]?/g;
  while ((m = mvRe.exec(command)) !== null) {
    paths.push(m[1], m[2]);
  }
  // Match touch/mkdir
  const touchRe = /\b(?:touch|mkdir)\s+(?:-[a-zA-Z]+\s+)?['"]?(\S+?)['"]?/g;
  while ((m = touchRe.exec(command)) !== null) {
    paths.push(m[1]);
  }
  // Match destructive unary commands such as rm -f .codex/pipeline/workflow-intent.json.
  const unaryRe = /\b(?:rm|rmdir|truncate)\s+(?:-[^\s]+\s+)*['"]?([^\s'"]+)['"]?/g;
  while ((m = unaryRe.exec(command)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

function extractPathsFromInput(toolInput, toolName) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const paths = [];
  const collect = (value) => {
    if (typeof value === 'string' && (value.includes('/') || value.includes('\\'))) {
      paths.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  // For Bash, use smart path extraction from command
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const bashPaths = extractBashTargetPaths(toolInput.command);
    paths.push(...bashPaths);
  }
  // Known path-bearing fields first
  for (const key of ['file_path', 'path', 'notebook_path', 'cell_path', 'files']) {
    if (key in toolInput) collect(toolInput[key]);
  }
  return paths;
}

function encodeSessionId(sessionId) {
  return `session-${Buffer.from(sessionId, 'utf8').toString('base64url')}`;
}

function execWindowPath(cwd, sessionId) {
  return path.join(cwd, '.codex', 'pipeline', 'sessions', `${encodeSessionId(sessionId)}.exec-window`);
}

function sessionLockPath(cwd) {
  return path.join(cwd, '.codex', 'pipeline', 'session-lock.json');
}

function changeContractPath(cwd) {
  return path.join(cwd, '.codex', 'pipeline', 'change-contract.json');
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readSessionLock(cwd) {
  try {
    const p = sessionLockPath(cwd);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
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

function readChangeContract(cwd) {
  try {
    const p = changeContractPath(cwd);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      allowed_files: Array.isArray(parsed.allowed_files) ? parsed.allowed_files.filter((entry) => typeof entry === 'string') : [],
      allowed_new_files: Array.isArray(parsed.allowed_new_files) ? parsed.allowed_new_files.filter((entry) => typeof entry === 'string') : [],
      forbidden_files: Array.isArray(parsed.forbidden_files) ? parsed.forbidden_files.filter((entry) => typeof entry === 'string') : [],
    };
  } catch {
    return { corrupted: true };
  }
}

function sessionLockExists(cwd) {
  try {
    return fs.existsSync(sessionLockPath(cwd));
  } catch {
    return false;
  }
}

function readExecWindow(cwd, sessionId) {
  try {
    const p = execWindowPath(cwd, sessionId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function realpathWithExistingAncestor(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    // The write target often does not exist yet. Canonicalize the nearest
    // existing parent so macOS /var -> /private/var does not look like escape.
  }

  const pendingParts = [];
  let cursor = targetPath;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return targetPath;
    pendingParts.unshift(path.basename(cursor));
    cursor = parent;
  }

  try {
    return path.join(fs.realpathSync(cursor), ...pendingParts);
  } catch {
    return targetPath;
  }
}

function isAllowedPath(cwd, filePath) {
  // Resolve relative paths (e.g., from Bash command parsing)
  let resolved = path.resolve(cwd, filePath);
  let workspaceRoot = path.resolve(cwd);

  // Follow symlinks to prevent symlink-escape attacks (.codex/escape -> ../../outside)
  resolved = realpathWithExistingAncestor(resolved);
  try {
    workspaceRoot = fs.realpathSync(workspaceRoot);
  } catch {
    // Keep the resolved cwd fallback if the temporary workspace disappeared.
  }

  const relative = path.relative(workspaceRoot, resolved);
  // Reject paths that escape the workspace (path traversal)
  if (relative.startsWith('..')) return false;
  // Allow paths inside .codex/ or pipeline-runs/ unless protected state checks
  // have already denied the operation.
  const normalized = relative.replace(/\\/g, '/');
  const firstPart = normalized.split('/')[0];
  return ALLOWED_PATHS.includes(firstPart);
}

function normalizeRelativePath(cwd, filePath) {
  const resolved = realpathWithExistingAncestor(path.resolve(cwd, filePath));
  let workspaceRoot = path.resolve(cwd);
  try {
    workspaceRoot = fs.realpathSync(workspaceRoot);
  } catch {
    // Keep the resolved cwd fallback if the temporary workspace disappeared.
  }
  return path.relative(workspaceRoot, resolved).replace(/\\/g, '/');
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

function stateObjectExpired(state) {
  return typeof state.expires_at !== 'number' || state.expires_at <= nowEpochSeconds();
}

function requiredFirstActionsPending(cwd) {
  const state = readJsonIfExists(path.join(cwd, '.codex', 'pipeline', 'required-first-actions.json'));
  if (!state) return false;
  if (state.corrupted) return true;
  if (!stateObjectIntegrityVerified(state, 'pipeline-required-first-actions')) return true;
  if (
    !state
    || typeof state !== 'object'
    || state.status !== 'active'
    || state.plugin !== PIPELINE_NAMESPACE
    || stateObjectExpired(state)
  ) {
    return false;
  }
  const requiredActions = Array.isArray(state.required_actions)
    ? state.required_actions.filter((entry) => typeof entry === 'string')
    : [];
  const completedActions = new Set(
    Array.isArray(state.completed_actions)
      ? state.completed_actions.filter((entry) => typeof entry === 'string')
      : [],
  );
  return requiredActions.some((action) => !completedActions.has(action));
}

function normalizeLexicalRelativePath(cwd, filePath) {
  return path.relative(path.resolve(cwd), path.resolve(cwd, filePath)).replace(/\\/g, '/');
}

function relativePathTouchesProtectedPipelineState(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith('.codex/pipeline/')
    && [...PROTECTED_PIPELINE_STATE_STEMS].some((stem) => normalized.includes(stem));
}

function isProtectedPipelineStatePath(cwd, filePath) {
  const lexical = normalizeLexicalRelativePath(cwd, filePath);
  const resolved = normalizeRelativePath(cwd, filePath);
  const lexicalLower = lexical.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  return PROTECTED_PIPELINE_STATE_FILES.has(lexicalLower)
    || PROTECTED_PIPELINE_STATE_FILES.has(resolvedLower)
    || relativePathTouchesProtectedPipelineState(lexical)
    || relativePathTouchesProtectedPipelineState(resolved);
}

function contractPatternMatches(pattern, filePath) {
  const normalizedPattern = String(pattern).replace(/\\/g, '/');
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  return filePath === normalizedPattern;
}

function validateScopeLock(cwd, contract, paths) {
  if (!contract) {
    return { ok: true };
  }

  if (contract.corrupted) {
    return {
      ok: false,
      reason: 'change-contract file is corrupted',
      outsideAllowed: [],
      forbiddenTouched: [],
    };
  }

  const outsideAllowed = [];
  const forbiddenTouched = [];
  for (const filePath of paths) {
    if (isAllowedPath(cwd, filePath)) continue;
    const relative = normalizeRelativePath(cwd, filePath);
    if (relative.startsWith('..')) {
      outsideAllowed.push(relative);
      continue;
    }

    if (contract.forbidden_files.some((pattern) => contractPatternMatches(pattern, relative))) {
      forbiddenTouched.push(relative);
      continue;
    }

    const exists = fs.existsSync(path.resolve(cwd, relative));
    const allowlist = exists ? contract.allowed_files : contract.allowed_new_files;
    if (!allowlist.some((pattern) => contractPatternMatches(pattern, relative))) {
      outsideAllowed.push(relative);
    }
  }

  if (outsideAllowed.length > 0 || forbiddenTouched.length > 0) {
    return {
      ok: false,
      reason: 'CHANGE_CONTRACT_SCOPE',
      outsideAllowed,
      forbiddenTouched,
    };
  }

  return { ok: true };
}

function isProtectedTool(toolName) {
  return PROTECTED_TOOLS.has(toolName);
}

function emit(output) {
  if (output && Object.keys(output).length > 0) {
    console.log(JSON.stringify(output));
  }
}

function handle(input) {
  const toolName = (input && input.tool_name) || '';
  const toolInput = (input && input.tool_input) || {};
  const cwd = process.cwd();
  const now = nowEpochSeconds();

  // Not a protected tool → allow silently
  if (!isProtectedTool(toolName)) {
    return;
  }

  const lock = readSessionLock(cwd);

  // Lock file exists but is corrupted → fail-closed
  if (!lock && sessionLockExists(cwd)) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: 'session-lock file is corrupted',
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Edit guard blocked: session-lock file is corrupted. Cannot determine session state.',
      },
    });
    return;
  }

  // No active session → not in pipeline context → allow
  if (!lock || lock.expires_at <= now) {
    return;
  }

  if (toolName === 'Bash' && requiredFirstActionsPending(cwd)) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: 'required first actions pending',
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Edit guard blocked Bash: required pipeline first actions are still pending. ' +
          'Only the visible plan, workflow/capability gates, canonical pipeline-controller spawn, and wait_agent may run before bootstrap completes. ' +
          'Do not stop or switch to manual fallback; redirect immediately to the canonical pipeline-controller bootstrap sequence.',
      },
    });
    return;
  }

  // Bash special handling: if command modifies files, treat like Edit/Write
  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (!bashCommandModifiesFiles(command)) {
      if (bashCommandMentionsPipelineStateArea(command)) {
        recordHookEvent({
          hook: 'edit-guard',
          event: 'PreToolUse',
          decision: 'deny',
          attempted: toolName,
          reason: 'protected pipeline state area',
        });
        emit({
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason:
              `Edit guard blocked ${toolName}: Bash commands mentioning .codex/pipeline during an active session must not bypass protected state parsing.`,
          },
        });
      }
      return; // Read-only bash is allowed outside the protected pipeline state area.
    }
    const protectedStatePaths = protectedPipelineStateMentionsInBash(command);
    if (protectedStatePaths.length === 0 && bashCommandMentionsPipelineStateArea(command)) {
      protectedStatePaths.push('.codex/pipeline');
    }
    if (protectedStatePaths.length > 0) {
      recordHookEvent({
        hook: 'edit-guard',
        event: 'PreToolUse',
        decision: 'deny',
        attempted: toolName,
        reason: 'protected pipeline state file',
      });
      emit({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Edit guard blocked ${toolName}: protected pipeline state files cannot be modified by tools during an active session: ` +
            protectedStatePaths.join(', '),
        },
      });
      return;
    }
    // Fall through to exec-window check for file-modifying bash
  }

  // Collect all paths from tool_input (not just file_path)
  const paths = extractPathsFromInput(toolInput, toolName);

  const protectedStatePaths = paths
    .filter((p) => isProtectedPipelineStatePath(cwd, p))
    .map((p) => normalizeLexicalRelativePath(cwd, p));
  if (protectedStatePaths.length > 0) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: 'protected pipeline state file',
      paths: protectedStatePaths,
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Edit guard blocked ${toolName}: protected pipeline state files cannot be modified by tools during an active session: ` +
          protectedStatePaths.join(', '),
      },
    });
    return;
  }

  // If any path is inside allowed directories → allow regardless of window
  if (paths.length > 0 && paths.every((p) => isAllowedPath(cwd, p))) {
    return;
  }

  // If there are paths and at least one is outside allowed dirs → require exec-window
  // Also require exec-window for Bash with modifying commands (even if no explicit path)
  const requiresWindow = paths.length === 0
    ? (toolName === 'Bash' && bashCommandModifiesFiles(toolInput.command || ''))
    : paths.some((p) => !isAllowedPath(cwd, p));

  if (!requiresWindow) {
    return;
  }

  // Session is active and path is outside allowed dirs → require exec-window
  const window = readExecWindow(cwd, lock.session_id);

  if (!window) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: 'exec-window CLOSED — no exec-window file found',
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Edit guard blocked ${toolName}: pipeline session is active but exec-window is CLOSED. ` +
          `Open an exec-window first via: node scripts/exec-window/open.cjs ` +
          `{ "session_id": "${lock.session_id}", "purpose": "...", "spawning_agent": "..." }`,
      },
    });
    return;
  }

  if (window.expires_at <= now) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: `exec-window EXPIRED (expires_at=${window.expires_at})`,
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Edit guard blocked ${toolName}: exec-window is EXPIRED (expires_at=${window.expires_at}). ` +
          `Open a fresh exec-window via: node scripts/exec-window/open.cjs ` +
          `{ "session_id": "${lock.session_id}", "purpose": "...", "spawning_agent": "..." }`,
      },
    });
    return;
  }

  const contract = readChangeContract(cwd);
  const scopeLock = validateScopeLock(cwd, contract, paths);
  if (!scopeLock.ok) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: toolName,
      reason: scopeLock.reason,
      outsideAllowed: scopeLock.outsideAllowed,
      forbiddenTouched: scopeLock.forbiddenTouched,
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Edit guard blocked ${toolName}: CHANGE_CONTRACT_SCOPE violation. ` +
          `outside_allowed=${JSON.stringify(scopeLock.outsideAllowed)} ` +
          `forbidden_touched=${JSON.stringify(scopeLock.forbiddenTouched)}`,
      },
    });
    return;
  }

  // Exec-window is OPEN and valid → allow
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  let parsed = null;
  let parseError = false;
  const raw = (buffer || '').trim();
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parseError = true; }
  }
  if (parseError || !parsed) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      reason: 'malformed stdin JSON',
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'edit-guard-hook received malformed JSON on stdin',
      },
    });
    return;
  }
  try {
    handle(parsed);
  } catch (err) {
    recordHookEvent({
      hook: 'edit-guard',
      event: 'PreToolUse',
      decision: 'deny',
      reason: `hook crash: ${err && err.message ? err.message : String(err)}`,
    });
    emit({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: `edit-guard-hook crashed: ${err && err.message ? err.message : 'unknown error'}`,
      },
    });
  }
});
