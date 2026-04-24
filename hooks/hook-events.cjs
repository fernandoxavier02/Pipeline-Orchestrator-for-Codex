#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function recordHookEvent(event) {
  try {
    const dir = path.join(process.cwd(), '.codex', 'pipeline');
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      hook: event.hook,
      event: event.event,
      decision: event.decision,
      attempted: event.attempted ?? '',
      expected: event.expected ?? '',
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      reason: event.reason ?? '',
    };
    fs.appendFileSync(path.join(dir, 'hook-events.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Hook observability must never break the hook decision itself.
  }
}

module.exports = {
  recordHookEvent,
};
