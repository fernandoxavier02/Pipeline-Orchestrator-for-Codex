#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { signLedgerEntry } = require('./ledger-integrity.cjs');

// B11: bound the size of every free-text field that flows into the JSONL
// log. The Zod schema for `detail` (and equivalents) intentionally has
// no `.max()` to avoid breaking historical entries; truncation is done
// at the hook layer.
const HOOK_EVENT_DETAIL_MAX_CHARS = 200;

function clampDetail(value) {
  if (typeof value !== 'string') {
    return value ?? '';
  }
  return value.length <= HOOK_EVENT_DETAIL_MAX_CHARS
    ? value
    : value.slice(0, HOOK_EVENT_DETAIL_MAX_CHARS);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function findUp(start, relativePath) {
  let current = path.resolve(start);
  for (;;) {
    const candidate = path.join(current, relativePath);
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) return undefined;
    current = next;
  }
}

function resolvePluginMetadata() {
  const roots = [
    process.env.PLUGIN_ROOT,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter(Boolean);

  for (const root of roots) {
    const manifest = readJsonSafe(path.join(root, '.codex-plugin', 'plugin.json'));
    if (manifest) {
      return {
        name: typeof manifest.name === 'string' ? manifest.name : 'unknown-plugin',
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        root,
      };
    }
  }

  const manifestPath = findUp(process.cwd(), path.join('.codex-plugin', 'plugin.json'));
  const manifest = manifestPath ? readJsonSafe(manifestPath) : undefined;
  if (manifest) {
    return {
      name: typeof manifest.name === 'string' ? manifest.name : 'unknown-plugin',
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      root: path.dirname(path.dirname(manifestPath)),
    };
  }

  const packagePath = findUp(process.cwd(), 'package.json');
  const pkg = packagePath ? readJsonSafe(packagePath) : undefined;
  return {
    name: typeof pkg?.name === 'string' ? pkg.name : 'unknown-plugin',
    version: typeof pkg?.version === 'string' ? pkg.version : '0.0.0',
    root: packagePath ? path.dirname(packagePath) : undefined,
  };
}

function resolveRuntime() {
  if (process.env.CODEX_HOME || process.env.PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT) return 'codex';
  if (process.env.CODEX_CLI) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDECODE) return 'claude-code';
  return 'unknown';
}

function buildHashId(prefix, parts) {
  const hash = crypto.createHash('sha256')
    .update(parts.map((part) => part ?? '').join('\0'))
    .digest('base64url')
    .slice(0, 18);
  return `${prefix}-${hash}`;
}

function createExecutionIdentity(event, timestamp) {
  const metadata = resolvePluginMetadata();
  const surface = `hook:${event.hook || 'unknown'}`;
  const envTraceId = process.env.CODEX_PIPELINE_TRACE_ID || process.env.PIPELINE_TRACE_ID;
  const traceId = envTraceId || buildHashId('pipe', [
    metadata.name,
    metadata.version,
    process.env.CODEX_SESSION_ID || process.env.CLAUDE_SESSION_ID || '',
    process.cwd(),
    String(process.pid),
  ]);
  const eventId = buildHashId('evt', [
    traceId,
    surface,
    event.event || '',
    event.decision || '',
    timestamp,
    String(process.pid),
  ]);

  return {
    trace_id: traceId,
    workflow_id: traceId,
    event_id: eventId,
    plugin_name: clampDetail(metadata.name),
    plugin_version: clampDetail(metadata.version),
    runtime: resolveRuntime(),
    surface,
    cwd: process.cwd(),
    pid: process.pid,
    node_version: process.version,
    timestamp,
    ...(metadata.root ? { plugin_root: path.resolve(metadata.root) } : {}),
    source: 'hook',
  };
}

function recordHookEvent(event) {
  try {
    const dir = path.join(process.cwd(), '.codex', 'pipeline');
    fs.mkdirSync(dir, { recursive: true });
    const timestamp = new Date().toISOString();
    const entry = {
      hook: clampDetail(event.hook),
      event: clampDetail(event.event),
      decision: clampDetail(event.decision),
      attempted: clampDetail(event.attempted ?? ''),
      expected: clampDetail(event.expected ?? ''),
      timestamp,
      cwd: process.cwd(),
      reason: clampDetail(event.reason ?? ''),
      execution_identity: createExecutionIdentity(event, timestamp),
    };
    fs.appendFileSync(path.join(dir, 'hook-events.jsonl'), `${JSON.stringify(signLedgerEntry(entry))}\n`, 'utf8');
  } catch {
    // Hook observability must never break the hook decision itself.
  }
}

module.exports = {
  recordHookEvent,
  // exported for tests
  HOOK_EVENT_DETAIL_MAX_CHARS,
  clampDetail,
};
