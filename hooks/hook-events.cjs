#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

function recordHookEvent(event) {
  try {
    const dir = path.join(process.cwd(), '.codex', 'pipeline');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      hook: clampDetail(event.hook),
      event: clampDetail(event.event),
      decision: clampDetail(event.decision),
      attempted: clampDetail(event.attempted ?? ''),
      expected: clampDetail(event.expected ?? ''),
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      reason: clampDetail(event.reason ?? ''),
    };
    fs.appendFileSync(path.join(dir, 'hook-events.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
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
