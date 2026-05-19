#!/usr/bin/env node
'use strict';

/**
 * sentinel-hook.cjs — PreToolUse:spawn_agent/Agent guard for pipeline-orchestrator-for-codex.
 *
 * Protocol:
 *   - Exit 0 with no stdout → allow (silent pass)
 *   - Exit 0 with hookSpecificOutput deny → deny this tool call, reason fed to LLM
 *   - Exit 0 with hookSpecificOutput allow + additionalContext → allow with warning
 *   - Exit 2 with stderr → hard block, stderr fed to LLM
 *
 * Auto-discovers sentinel-state.json from .pipeline/docs/Pre-*-action/.
 * Falls back to PIPELINE_DOC_PATH env var if set.
 * NEVER spawns agents, writes files, or emits visual output.
 *
 * Ported from Claude Code pipeline-orchestrator v3.2.0
 * Adapted: namespace pipeline-orchestrator-for-codex, .codex/ paths
 */

const fs = require('fs');
const path = require('path');
const { recordHookEvent } = require('./hook-events.cjs');

// ── Auto-Discovery ──────────────────────────────────────────────────────────

// Find the most recent sentinel-state.json without depending on env vars.
// Priority 1: PIPELINE_DOC_PATH env var (backwards compatible override)
// Priority 2: Codex runtime state at .codex/pipeline/sentinel-state.json
// Priority 3: Scan .pipeline/docs/Pre-{level}-action/{session}/sentinel-state.json by mtime
// Returns: absolute path to sentinel-state.json, or null if not found.
function discoverStatePath() {
  // Priority 1: explicit env var (backwards compatible)
  const envPath = (process.env.PIPELINE_DOC_PATH || '').trim();
  if (envPath) {
    const candidate = path.join(envPath, 'sentinel-state.json');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }

  // Priority 2: Codex runtime controller state
  const codexRuntimeCandidate = path.join(process.cwd(), '.codex', 'pipeline', 'sentinel-state.json');
  try {
    if (fs.existsSync(codexRuntimeCandidate)) return codexRuntimeCandidate;
  } catch { /* ignore */ }

  // Priority 3: auto-discovery from .pipeline/docs/
  const baseDir = path.join(process.cwd(), '.pipeline', 'docs');
  try {
    if (!fs.existsSync(baseDir)) return null;
  } catch {
    return null;
  }

  let newest = null;
  let newestMtime = 0;

  try {
    for (const level of fs.readdirSync(baseDir)) {
      const levelDir = path.join(baseDir, level);
      if (!level.startsWith('Pre-')) continue;
      try {
        if (!fs.statSync(levelDir).isDirectory()) continue;
      } catch { continue; }

      for (const session of fs.readdirSync(levelDir)) {
        const candidate = path.join(levelDir, session, 'sentinel-state.json');
        try {
          const stat = fs.statSync(candidate);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newest = candidate;
          }
        } catch { /* not found, skip */ }
      }
    }
  } catch { /* baseDir read error, return null */ }

  return newest;
}

function normalizeState(state) {
  const expectedNextRaw = state.expectedNext ?? state.expected_next ?? [];
  const expectedNext = Array.isArray(expectedNextRaw)
    ? expectedNextRaw.filter((entry) => typeof entry === 'string')
    : typeof expectedNextRaw === 'string'
      ? [expectedNextRaw]
      : [];

  return {
    schemaVersion: state.schema_version,
    pipelineActive: state.pipelineActive ?? state.pipeline_active,
    currentPhase: state.currentPhase ?? state.current_phase,
    expectedNext,
    lastUpdated: state.updatedAt ?? state.last_updated,
    consecutiveCorrections: state.consecutiveCorrections ?? state.consecutive_corrections ?? 0,
    variant: state.variant,
  };
}

function extractPipelineAgentType(input) {
  const toolInput = input.tool_input || input.toolInput || {};
  const direct = toolInput.subagent_type || toolInput.subagentType || toolInput.target_name || toolInput.targetName;
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }

  const message = toolInput.message || toolInput.prompt || toolInput.description;
  if (typeof message === 'string') {
    const marker = message.match(/\bPIPELINE_AGENT_FQN:\s*([^\s\r\n]+)/u);
    if (marker?.[1]) return marker[1].trim();
  }

  return '';
}

// ── Main Handler ────────────────────────────────────────────────────────────

// Spec: pipeline-trust-restoration / R11 AC 11.2, 11.4 — fail-closed deny
// with a sanitized canonical reason. State file paths, exception messages,
// and payloads MUST stay out of the user-visible reason (avoid secret leak).
// Operator log goes to stderr and the structured hook-event record only.
const SENTINEL_SANITIZED_REASON = 'sentinel internal error — failing closed';

function handleInput(raw) {
  // 1. Parse stdin (tool_input from Codex CLI)
  let input;
  try {
    if (!raw || !raw.trim()) return process.exit(0); // empty stdin → allow
    input = JSON.parse(raw.trim());
  } catch (parseErr) {
    // R11 AC 11.2 — fail-closed deny with sanitized reason.
    process.stderr.write(
      `[sentinel-hook] malformed stdin JSON: ${parseErr && parseErr.message ? parseErr.message : String(parseErr)}\n`,
    );
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: SENTINEL_SANITIZED_REASON,
      }
    };
    console.log(JSON.stringify(output));
    return process.exit(0);
  }

  // 2. Extract agent identity from tool_input
  const fullAgentType = extractPipelineAgentType(input);

  // Only validate pipeline-orchestrator agents — allow all others
  // Support both namespaces: pipeline-orchestrator: and pipeline-orchestrator-for-codex:
  if (!fullAgentType || (!fullAgentType.startsWith('pipeline-orchestrator:') && !fullAgentType.startsWith('pipeline-orchestrator-for-codex:'))) {
    return process.exit(0); // not a pipeline agent, don't interfere
  }

  // "pipeline-orchestrator-for-codex:core:sentinel" → "sentinel"
  const agentName = fullAgentType.split(':').pop();

  // 3. Anti-loop: sentinel itself always passes
  if (agentName === 'sentinel') {
    return process.exit(0);
  }

  // 4. Discover state file (auto-discovery + env var fallback)
  const stateFilePath = discoverStatePath();

  // 5. No state file found — hybrid fail
  if (!stateFilePath) {
    // Bootstrap whitelist: these agents can run before state file exists
    const BOOTSTRAP_AGENTS = ['task-orchestrator'];

    if (BOOTSTRAP_AGENTS.includes(agentName)) {
      recordHookEvent({
        hook: 'sentinel',
        event: 'PreToolUse',
        decision: 'allow-bootstrap',
        attempted: agentName,
        expected: 'task-orchestrator',
        reason: 'bootstrap permitted without state',
      });
      return process.exit(0); // fail-open: bootstrap permitted
    }

    // Fail-closed: any other pipeline-orchestrator agent without state file
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'SENTINEL: No sentinel-state.json found.\n' +
          `Agent "${agentName}" requires an active pipeline with state tracking.\n\n` +
          'ACTION REQUIRED: Create sentinel-state.json before spawning pipeline agents.\n' +
          'If this is a new pipeline, spawn task-orchestrator first (it bootstraps the state file).\n' +
          'If resuming, use /pipeline-orchestrator-for-codex:pipeline continue to restore state.'
      }
    };
    recordHookEvent({
      hook: 'sentinel',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: agentName,
      expected: 'sentinel-state.json',
      reason: 'missing sentinel state',
    });
    console.log(JSON.stringify(output));
    return process.exit(0);
  }

  // 6. Read and parse state file
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (stateErr) {
    // Fail-closed: corrupted state file → deny (except bootstrap agents).
    const BOOTSTRAP_AGENTS_ON_CORRUPTION = ['task-orchestrator', 'sentinel'];
    if (BOOTSTRAP_AGENTS_ON_CORRUPTION.includes(agentName)) {
      recordHookEvent({
        hook: 'sentinel',
        event: 'PreToolUse',
        decision: 'allow-bootstrap-corrupted',
        attempted: agentName,
        reason: 'corrupted state file — bootstrap permitted',
      });
      return process.exit(0);
    }
    // R11 AC 11.2, 11.4 — sanitized reason; the state file path stays in
    // stderr (operator-only).
    process.stderr.write(
      `[sentinel-hook] corrupted state at ${stateFilePath}: ${stateErr && stateErr.message ? stateErr.message : String(stateErr)}\n`,
    );
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: SENTINEL_SANITIZED_REASON,
      }
    };
    recordHookEvent({
      hook: 'sentinel',
      event: 'PreToolUse',
      decision: 'deny',
      attempted: agentName,
      reason: 'corrupted state file',
    });
    console.log(JSON.stringify(output));
    return process.exit(0);
  }

  const normalizedState = normalizeState(state);

  // 7. Schema version check (legacy snake_case files only)
  if (normalizedState.schemaVersion !== undefined && normalizedState.schemaVersion !== 1) {
    return process.exit(0); // incompatible version → don't interfere
  }

  // 8. Pipeline inactive? → silent pass
  if (!normalizedState.pipelineActive) {
    return process.exit(0);
  }

  // 9. Stale state detection (collected, NOT early-return — divergence check must ALWAYS run)
  const STALE_THRESHOLD_MS = 300_000; // 300 seconds (5 minutes)
  const lastUpdated = normalizedState.lastUpdated ? new Date(normalizedState.lastUpdated).getTime() : 0;
  const elapsed = Date.now() - lastUpdated;
  let staleWarning = null;

  if (lastUpdated > 0 && elapsed > STALE_THRESHOLD_MS) {
    const elapsedSec = Math.round(elapsed / 1000);
    staleWarning =
      `SENTINEL WARNING: State file is ${elapsedSec}s old (threshold: 300s). ` +
      `The controller may have forgotten to update sentinel-state.json before this spawn. ` +
      `expectedNext="${normalizedState.expectedNext.join(', ') || '?'}" may be stale. ` +
      `Verify that you updated the state file via Write tool BEFORE this Agent call.`;
  }

  // 10. Circuit breaker: 3+ consecutive corrections
  if (normalizedState.consecutiveCorrections >= 3) {
    process.stderr.write(
      'SENTINEL CIRCUIT_BREAKER: 3 consecutive corrections without PASS. ' +
      'Pipeline needs manual intervention. ' +
      'Options: (a) Spawn sentinel agent with mode SEQUENCE_VALIDATION for diagnosis, ' +
      '(b) Ask the user to resolve, (c) Cancel pipeline.'
    );
    return process.exit(2); // hard block — stderr fed to LLM
  }

  // 11. Compare target vs expected_next (ALWAYS runs, even if stale)
  const expectedValues = normalizedState.expectedNext.map((entry) => entry.toLowerCase());
  const target = agentName.toLowerCase();

  if (expectedValues.includes(target)) {
    recordHookEvent({
      hook: 'sentinel',
      event: 'PreToolUse',
      decision: 'allow',
      attempted: agentName,
      expected: normalizedState.expectedNext.join(', '),
      reason: 'agent matched expectedNext',
    });
    // MATCH → allow (with stale warning if applicable)
    if (staleWarning) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: staleWarning
        }
      };
      console.log(JSON.stringify(output));
    }
    return process.exit(0);
  }

  // 12. Check if this is a known alias or partial match
  if (expectedValues.some((expected) => expected && fullAgentType.toLowerCase().endsWith(expected))) {
    recordHookEvent({
      hook: 'sentinel',
      event: 'PreToolUse',
      decision: 'allow',
      attempted: agentName,
      expected: normalizedState.expectedNext.join(', '),
      reason: 'agent matched expected suffix',
    });
    return process.exit(0); // suffix match → allow
  }

  // 13. DIVERGENCE — deny with reason
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `SENTINEL DIVERGENCE DETECTED.\n` +
        `  Attempted: "${agentName}"\n` +
        `  Expected:  "${normalizedState.expectedNext.join(', ')}" (Phase ${normalizedState.currentPhase || '?'}, Variant: ${normalizedState.variant || '?'})\n\n` +
        `ACTION REQUIRED: Spawn the sentinel agent with PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:sentinel ` +
        `with mode SEQUENCE_VALIDATION to diagnose and auto-correct.\n` +
        `Pass these parameters in the prompt:\n` +
        `  - mode: SEQUENCE_VALIDATION\n` +
        `  - state_file_path: ${stateFilePath}\n` +
        `  - trigger: hook_deny\n` +
        `  - deny_reason: Attempted "${agentName}" but expected "${normalizedState.expectedNext.join(', ')}"`
    }
  };
  recordHookEvent({
    hook: 'sentinel',
    event: 'PreToolUse',
    decision: 'deny',
    attempted: agentName,
    expected: normalizedState.expectedNext.join(', '),
    reason: 'sentinel divergence',
  });
  console.log(JSON.stringify(output));
  process.exit(0);
}

// Cross-platform stdin reading (works on Windows + Unix)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  // Spec: pipeline-trust-restoration / R11 AC 11.2, 11.4 — outer fail-closed
  // guard. Any uncaught exception inside handleInput (e.g. a non-object stdin
  // payload that bypasses the early JSON.parse, a filesystem error during
  // discovery, a normalization crash on malformed state) MUST surface as a
  // deny with the sanitized canonical reason, not a non-zero exit that the
  // Codex host could treat as "allow on crash".
  try {
    handleInput(input);
  } catch (err) {
    process.stderr.write(
      `[sentinel-hook] internal error: ${err && err.message ? err.message : String(err)}\n`,
    );
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: SENTINEL_SANITIZED_REASON,
      }
    };
    try {
      recordHookEvent({
        hook: 'sentinel',
        event: 'PreToolUse',
        decision: 'deny',
        reason: 'hook crash',
      });
    } catch { /* recording the deny is best-effort; never block the deny itself */ }
    console.log(JSON.stringify(output));
    process.exit(0);
  }
});
