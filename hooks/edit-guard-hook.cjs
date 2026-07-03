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
const { realpathOfExistingAncestor } = require('./path-safety.cjs');

const PROTECTED_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash']);
const PIPELINE_NAMESPACE = 'pipeline-orchestrator-for-codex';
const ALLOWED_PATHS = ['.codex', 'pipeline-runs'];
// ARCH-2: this frozen set (obligation + lock + sentinel files that must not be
// tampered with mid-run) deliberately does NOT include `session.json`, unlike
// pipeline-reset.cjs's PIPELINE_STATE_FILES. `session.json` is mutable working
// state the running pipeline updates in place, so the guard must leave it
// editable inside .codex/pipeline (see the "allows Edit inside .codex/pipeline/"
// test). pipeline-reset lists it because teardown deletes ALL session state; the
// two lists answer different questions and are intentionally different.
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

// Write-verb patterns, kept in MATCH-ANYWHERE form (\b...\b) so a verb hidden by
// quoting (`"cp" a b`), a flag-bearing wrapper (`env -i cp`, `sudo -u root cp`),
// or a `bash -c "..."` wrapper still fires. The 4 known false positives
// (echo "mv a b", npm/pip install, arrow strings ->/=> , read-only heredoc /
// mention) are handled SURGICALLY below, NOT by narrowing these patterns.
// Post-review (SEC-007): covers dd, rsync, ln -s, truncate, and language
// runtimes that open files for write.
const BASH_WRITE_VERB_PATTERNS = [
  /\b(rm|rmdir|mv|cp|chmod|chown|touch|mkdir|tee)\b/,
  /\bsed\b.*\s(?:-i|--in-place)/,   // sed -i / sed -i.bak / sed --in-place
  /\bdd\b.*\bof=/,                // dd of=<path>
  /\brsync\b.*--delete/,          // rsync --delete dest/
  /\btruncate\b/,                 // truncate -s 0 <path>
  /\bln\b\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*s/, // ln -s, ln -sf, ln -fs
  // Language runtimes opening files for write.
  /\bpython3?\b.*\bopen\s*\([^)]*['"]w/,
  /\bperl\b.*\bopen\s*\(.*['"]>/,
  // Filesystem-mutating method calls, matched wherever they appear (not tied to
  // the interpreter keyword). Relaxing read-only `.codex/pipeline` mentions
  // means interpreter deletes must still be caught here, and a separator inside
  // an interpreter's quoted -c/-e argument (e.g. `python -c "import os; ..."`)
  // must not split the interpreter keyword away from the call. Paren-anchored
  // to avoid matching a file merely named after an fs API.
  /\b(os\.(remove|unlink|rmdir|removedirs|rename|replace|truncate|makedirs|mkdir)|shutil\.(rmtree|move|copy|copyfile|copy2))\s*\(/,
  /\b(File\.(delete|unlink|rename|write)|FileUtils\.\w+|Dir\.(delete|rmdir|mkdir))\s*\(/,
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|rmSync|rmdirSync|unlinkSync|renameSync|mkdirSync|truncateSync|ftruncateSync|symlinkSync|linkSync|chmodSync|chownSync|writeSync|outputFileSync|removeSync)\s*\(/,
];

// GNU coreutils `install` (a real filesystem-write verb) only when it is the
// COMMAND word of the segment — optionally path-prefixed (`/usr/bin/install`).
// Anchoring here means `cat install.md` and `npm run install-deps` are not
// mistaken for a write (M1), so no package-manager allowlist is needed.
// ponytail: no leading-wrapper support (`sudo install`); add if a case appears.
const GNU_INSTALL_RE = /^(?:\S*\/)?install\b/;

// Anti-chaining tokenizer (SHARED). Splits on every shell separator that can
// smuggle a second command past a single-invocation check: && || ; | & (lone
// background), backtick, the $( opener of a command substitution, and NEWLINE /
// CARRIAGE-RETURN (a bare line break runs the next line as its own command, so
// `node reset.cjs\nrm -rf x` is two invocations, not one). A bare `)` is NOT a
// separator (it appears in ordinary code like `node -e "fs.rmSync(x)"`);
// splitting on the $( opener already isolates the smuggled sub-command. Any
// resulting extra segment means it is NOT a single invocation.
function tokenizeSegments(command) {
  if (typeof command !== 'string') return [];
  return command
    .split(/\|\||&&|[;|&`\n\r]|\$\(/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

// A data printer (echo/printf) treats its quoted args as text, so a write verb
// inside the printed string must NOT fire. `bash -c "..."` is NOT a printer —
// its quoted content is code and must still be scanned.
function isDataPrinter(segment) {
  return /^(echo|printf)\b/.test(segment.trim());
}

// POSIX-aware single-pass segment scanner. Replaces the previous backslash-blind
// regex quote-stripping (stripQuotedContent / collapseQuoteObfuscation /
// leading-unwrap / code-flag capture), whose global `"[^"]*"` pass paired quotes
// across UNRELATED regions (C2) and could be defeated by escaped quotes
// (I2/ARCH-M3). It walks the segment char by char tracking quote mode
// {NONE, SINGLE, DOUBLE} with POSIX backslash rules — no escapes inside single
// quotes; inside double quotes `\` escapes only " \ $ ` ; outside, `\` escapes
// the next char and joins words — and exposes three views:
//   unquoted     — characters seen OUTSIDE any quote, for real redirect
//                  detection (`>` / `>>` / `2>` / `>|` all contain `>`);
//   words        — argv words with quote-adjacency + escapes resolved, so
//                  `"c"p` / `c"p"` / `c""p` / `c''p` / `\c\p` / `$'cp'` all
//                  collapse to the bare verb for the match-anywhere verb scan;
//   codePayloads — the argument that follows an interpreter code flag
//                  (-c/-e/--eval/--command), escapes resolved, so an inner `\"`
//                  does NOT truncate the captured code (ARCH-M3).
const CODE_FLAGS = new Set(['-c', '-e', '--eval', '--command']);
// ADV-3: attached code-flag forms — short flags fused with their payload
// (`-c<payload>`, `-e<payload>`) and long flags with `=` (`--eval=<payload>`,
// `--command=<payload>`) — bypassed the words[i]===flag capture. These lists
// let scanSegment split the fused tail out as a code payload.
const SHORT_CODE_FLAGS = ['-c', '-e'];
const LONG_CODE_FLAGS = ['--eval', '--command'];

// ADV-2: argv-transparent wrappers exec their trailing argv as a fresh command,
// so the effective write verb is a LATER word, not words[0]. Peeling them lets a
// quote-obfuscated verb behind the wrapper (`sudo "c"p`, `env \c\p`) still be
// scanned as the command word.
const ARGV_TRANSPARENT_WRAPPERS = new Set([
  'sudo', 'env', 'nice', 'timeout', 'xargs', 'command', 'doas', 'stdbuf', 'setsid', 'chroot',
]);

function scanSegment(segment) {
  const words = [];
  const codePayloads = [];
  let unquoted = '';
  let word = '';
  let inWord = false;
  let mode = 0; // 0 = NONE, 1 = SINGLE, 2 = DOUBLE, 3 = ANSI-C ($'...')
  const flush = () => {
    if (inWord) {
      words.push(word);
      word = '';
      inWord = false;
    }
  };
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (mode === 1) { // SINGLE — no escapes at all
      if (ch === "'") mode = 0;
      else { word += ch; inWord = true; }
      continue;
    }
    if (mode === 3) { // ANSI-C $'...' — C-style backslash escapes; `\'` does NOT close
      if (ch === '\\' && i + 1 < segment.length) {
        word += segment[i + 1];
        inWord = true;
        i += 1;
        continue;
      }
      if (ch === "'") { mode = 0; continue; }
      word += ch;
      inWord = true;
      continue;
    }
    if (mode === 2) { // DOUBLE — `\` escapes only " \ $ `
      if (ch === '"') { mode = 0; continue; }
      if (ch === '\\' && '"\\$`'.includes(segment[i + 1])) {
        word += segment[i + 1];
        inWord = true;
        i += 1;
        continue;
      }
      word += ch;
      inWord = true;
      continue;
    }
    // NONE
    if (ch === '\\') {
      if (i + 1 < segment.length) {
        word += segment[i + 1];
        inWord = true;
        i += 1;
      }
      continue;
    }
    if (ch === '$' && segment[i + 1] === "'") { mode = 3; inWord = true; i += 1; continue; }
    if (ch === "'") { mode = 1; inWord = true; continue; }
    if (ch === '"') { mode = 2; inWord = true; continue; }
    if (ch === ' ' || ch === '\t') { unquoted += ch; flush(); continue; }
    word += ch;
    inWord = true;
    unquoted += ch;
  }
  flush();
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (CODE_FLAGS.has(w)) {
      if (i + 1 < words.length) codePayloads.push(words[i + 1]);
      continue;
    }
    // ADV-3 attached forms: `-c<payload>` / `-e<payload>` (short flag fused with
    // its code) and `--eval=<payload>` / `--command=<payload>` (long flag with
    // `=`). Without these, `bash -c"cp x y"` and `node --eval="fs.rmSync('x')"`
    // captured no payload and slipped past the verb scan.
    const short = SHORT_CODE_FLAGS.find((f) => w.startsWith(f) && w.length > f.length);
    if (short) { codePayloads.push(w.slice(short.length)); continue; }
    const long = LONG_CODE_FLAGS.find((f) => w.startsWith(`${f}=`));
    if (long) { codePayloads.push(w.slice(long.length + 1)); }
  }
  return { unquoted, words, codePayloads };
}

// C2: a `>` reaches the UNQUOTED view only when it is a real POSIX redirection
// outside every quote — including `x => y` / `x -> y` (the `>` redirects, the
// `=`/`-` is just a word) and `var=>file`. A `>` living inside quotes
// (`echo "x => y"`, `git commit -m "a->b"`) never lands in `unquoted`, so it is
// inert data and does NOT count.
function segmentHasRedirection(segment) {
  return scanSegment(segment).unquoted.includes('>');
}

// Verb-scan text for non-printer segments (ARCH-M3):
//   * the COMMAND word (word[0], resolved) so a quoted/obfuscated verb still
//     fires (`"cp" a b`, `c""p`, `\c\p`, `$'cp'`);
//   * every UNQUOTED argument so `env -i cp` / `sudo -u root cp` fire;
//   * any interpreter code payload so `bash -c "cp x"`,
//     `python -c "os.remove(...)"`, `node -e "...rmSync(...)"` stay scannable.
// A quoted DATA argument (`git commit -m "cp helper"`) is in none of these, so
// it stays inert.
// ADV-2: effective command word after peeling argv-transparent wrappers and
// their leading flags, so a quote-obfuscated verb behind a wrapper (`sudo "c"p`,
// `env \c\p`) is scanned as the command — not just words[0]. Handles nesting
// (`sudo env cp`). Known ceiling: a separate-value flag (`sudo -u root cp`)
// makes the value look like the command word; the unquoted-argument scan is the
// backstop for that (non-obfuscated) case.
// ponytail: no separate flag-value consumption; add if a wrapper flag-value +
// quoted-verb combo (`sudo -u root "c"p`) shows up in the wild.
function resolveCommandWord(words) {
  let i = 0;
  while (i < words.length) {
    const base = words[i].replace(/^.*\//, '');
    if (ARGV_TRANSPARENT_WRAPPERS.has(base)) {
      i += 1;
      while (i < words.length && words[i].startsWith('-')) i += 1;
      continue;
    }
    return words[i];
  }
  return '';
}

function verbScanText(segment) {
  const scan = scanSegment(segment);
  // A data printer's args are pure text — scan only the unquoted portion so
  // `echo "mv a b"` is inert while `echo x => y` (a redirect) is still caught by
  // segmentHasRedirection above.
  if (isDataPrinter(segment)) return scan.unquoted;
  // firstWord stays at index 0 so GNU_INSTALL_RE's `^install` anchor still fires
  // only when install is the literal command; commandWord is the wrapper-peeled
  // verb for the match-anywhere BASH_WRITE_VERB_PATTERNS.
  const firstWord = scan.words.length > 0 ? scan.words[0] : '';
  const commandWord = resolveCommandWord(scan.words);
  return `${firstWord} ${commandWord} ${scan.unquoted} ${scan.codePayloads.join(' ')}`;
}

function segmentModifiesFiles(segment) {
  const seg = segment.trim();
  if (!seg) return false;
  if (segmentHasRedirection(seg)) return true;
  const scanText = verbScanText(seg);
  if (BASH_WRITE_VERB_PATTERNS.some((re) => re.test(scanText))) return true;
  // GNU `install` as the command verb (heredoc redirects are handled above).
  if (GNU_INSTALL_RE.test(scanText)) return true;
  return false;
}

function bashCommandModifiesFiles(command) {
  if (typeof command !== 'string') return false;
  return tokenizeSegments(command).some(segmentModifiesFiles);
}

// Escape-route allowlist: the deterministic recovery scripts. Resolved against
// cwd then the plugin roots (mirrors dispatch-guard.cjs), so the guard cannot
// trap the operator when it cannot itself be edited.
const ESCAPE_SCRIPT_RELATIVES = {
  reset: [path.join('scripts', 'pipeline-reset.cjs')],
  window: [
    path.join('scripts', 'exec-window', 'open.cjs'),
    path.join('scripts', 'exec-window', 'close.cjs'),
  ],
};

function pluginRoots(cwd) {
  return [
    cwd,
    process.env.PLUGIN_ROOT,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter((root) => typeof root === 'string' && root.length > 0);
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// I1: canonicalise via realpath so the allowlist compares REAL targets, not
// lexical paths — otherwise a symlink planted at `scripts/pipeline-reset.cjs`
// pointing at arbitrary code would spoof the escape route (RCE).
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// Classify a Bash command as a pure escape-script invocation. Returns 'reset',
// 'window', or null. Exemption requires the ENTIRE command to be ONE segment
// (F1: no chaining, incl. lone `&`) with NO trailing redirection (F7).
function classifyEscapeCommand(command, cwd) {
  // C1 defense-in-depth: a newline runs the rest as a separate command, so a
  // multi-line "invocation" is never a lone escape script.
  if (typeof command === 'string' && /[\n\r]/.test(command)) return null;
  const segments = tokenizeSegments(command);
  if (segments.length !== 1) return null;
  const seg = segments[0];
  if (segmentHasRedirection(seg)) return null;
  // The script path may be quoted (repo paths can contain spaces).
  const match = seg.match(/^node\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s.*)?$/);
  if (!match) return null;
  const scriptRaw = match[1] || match[2] || match[3];
  const scriptAbs = path.resolve(cwd, scriptRaw);
  // I1: never exempt a script that is itself a symlink (it could point at
  // arbitrary code), and compare canonical realpaths on both sides.
  if (isSymlink(scriptAbs)) return null;
  const scriptReal = realpathOrSelf(scriptAbs);
  for (const [kind, relatives] of Object.entries(ESCAPE_SCRIPT_RELATIVES)) {
    for (const root of pluginRoots(cwd)) {
      if (relatives.some((rel) => samePath(realpathOrSelf(path.resolve(root, rel)), scriptReal))) {
        return kind;
      }
    }
  }
  return null;
}

// Executable, JSON-quoted escape command surfaced in deny reasons so a blocked
// caller is told exactly how to recover instead of being trapped.
function resetCommandHint(cwd) {
  const rel = path.join('scripts', 'pipeline-reset.cjs');
  for (const root of pluginRoots(cwd)) {
    const abs = path.resolve(root, rel);
    try {
      if (fs.existsSync(abs)) return `node ${JSON.stringify(abs)}`;
    } catch {
      // Try the next root.
    }
  }
  return `node ${JSON.stringify(path.resolve(cwd, rel))}`;
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

// Shared symlink-defense canonicalizer (hooks/path-safety.cjs); fall back to the
// lexical target when nothing along the chain resolves (fail-open to lexical —
// the containment check downstream still rejects a `..` escape).
function realpathWithExistingAncestor(targetPath) {
  return realpathOfExistingAncestor(targetPath) || targetPath;
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

// Tampered = the guard cannot trust the on-disk state. pipeline-reset stays
// permitted even here (it only deletes state); open/close do NOT, so a tampered
// session can be recovered but not silently re-armed with write access.
function stateTampered(cwd) {
  if (!readSessionLock(cwd) && sessionLockExists(cwd)) return true;
  const dir = path.join(cwd, '.codex', 'pipeline');
  const rfa = readJsonIfExists(path.join(dir, 'required-first-actions.json'));
  if (rfa && (rfa.corrupted || !stateObjectIntegrityVerified(rfa, 'pipeline-required-first-actions'))) {
    return true;
  }
  const sentinel = readJsonIfExists(path.join(dir, 'sentinel-state.json'));
  if (sentinel && sentinel.corrupted) return true;
  return false;
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

  // Escape-route allowlist — evaluated BEFORE any state read so it survives a
  // corrupted lock / tampered state / pending bootstrap ("prison without exit").
  if (toolName === 'Bash') {
    const escape = classifyEscapeCommand(toolInput.command || '', cwd);
    if (escape === 'reset') {
      recordHookEvent({
        hook: 'edit-guard',
        event: 'PreToolUse',
        decision: 'allow',
        attempted: toolName,
        reason: 'pipeline-reset escape route',
      });
      return;
    }
    if (escape === 'window' && !stateTampered(cwd)) {
      recordHookEvent({
        hook: 'edit-guard',
        event: 'PreToolUse',
        decision: 'allow',
        attempted: toolName,
        reason: 'exec-window escape route',
      });
      return;
    }
    // escape === 'window' under tampered state → fall through to normal denial.
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
          'Do not stop or switch to manual fallback; redirect immediately to the canonical pipeline-controller bootstrap sequence. ' +
          `To reset a wedged pipeline instead, run: ${resetCommandHint(cwd)}`,
      },
    });
    return;
  }

  // Bash special handling: if command modifies files, treat like Edit/Write
  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (!bashCommandModifiesFiles(command)) {
      // Read-only Bash is allowed, EVEN when it mentions .codex/pipeline
      // (e.g. `cat .codex/pipeline/sentinel-state.json`). Only writes to the
      // protected state are denied — and those are caught by the modifying
      // branch below (including `node -e "...rmSync(...)"`).
      return;
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
            protectedStatePaths.join(', ') +
            `. To reset a wedged pipeline, run: ${resetCommandHint(cwd)}`,
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
