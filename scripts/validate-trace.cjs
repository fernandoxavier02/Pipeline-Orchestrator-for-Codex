#!/usr/bin/env node
'use strict';

const fs = require('fs');

const REQUIRED_SECTIONS = [
  '## Classification',
  '## Pipeline Definition (snapshot)',
  '## Execution Log',
  '## Final Verdict',
];

const REQUIRED_HEADER_FIELDS = [
  'trace_schema_version',
  'timestamp_utc',
  'started_at',
  'ended_at',
  'duration_seconds',
  'plugin_version',
  'user_identity',
  'branch',
  'repo',
  'task',
];

function validate(trace) {
  const errors = [];

  for (const field of REQUIRED_HEADER_FIELDS) {
    if (!new RegExp(`^-\\s*${field}:\\s*\\S`, 'm').test(trace)) {
      errors.push(`Missing required header field: ${field}.`);
    }
  }

  const schemaMatch = trace.match(/-\s*trace_schema_version:\s*(\S+)/);
  if (!schemaMatch) {
    errors.push('Missing trace_schema_version: 1 header field.');
  } else if (schemaMatch[1] !== '1') {
    errors.push(`Unsupported trace_schema_version: ${schemaMatch[1]}.`);
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!trace.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  const positions = REQUIRED_SECTIONS.map((section) => trace.indexOf(section));
  if (positions.every((position) => position >= 0)) {
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index] <= positions[index - 1]) {
        errors.push('Required sections are out of order.');
        break;
      }
    }
  }

  if (!/## Execution Log[\s\S]*### Phase:\s*\S+/.test(trace)) {
    errors.push('Execution Log must contain at least one phase entry.');
  }

  if (!/## Final Verdict[\s\S]*-\s*status:\s*(SUCCESS|DONE_WITH_CONCERNS|BLOCKED)/.test(trace)) {
    errors.push('Final verdict status must be SUCCESS, DONE_WITH_CONCERNS, or BLOCKED.');
  }

  if (trace.includes('## Plan Mode')) {
    for (const field of ['plan_mode_skipped', 'plan_override_attempted', 'justification']) {
      if (!new RegExp(`## Plan Mode[\\s\\S]*-\\s*${field}:\\s*\\S`).test(trace)) {
        errors.push(`Plan Mode is missing required field: ${field}.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/validate-trace.cjs <TRACE.md>');
    process.exit(2);
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const result = validate(raw);
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }

  process.exit(0);
}

module.exports = { validate };
