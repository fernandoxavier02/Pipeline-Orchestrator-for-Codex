#!/usr/bin/env node
'use strict';

const GOVERNED_SKILLS = Object.freeze([
  'pipeline',
  'brainstorm',
  'audit',
  'audit-heavy',
  'audit-light',
  'bugfix',
  'bugfix-heavy',
  'bugfix-light',
  'feature',
  'feature-heavy',
  'feature-light',
  'review',
  'spec',
  'spec-audit-only',
  'spec-design',
  'spec-heavy',
  'spec-init',
  'spec-light',
  'spec-requirements',
  'spec-tasks',
  'validate-design',
  'validate-gap',
  'verify-completion',
]);

const GOVERNED_SKILL_SET = new Set(GOVERNED_SKILLS);

module.exports = {
  GOVERNED_SKILLS,
  GOVERNED_SKILL_SET,
};
