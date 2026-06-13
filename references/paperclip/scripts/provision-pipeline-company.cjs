#!/usr/bin/env node
/*
 * provision-pipeline-company.cjs
 * ------------------------------------------------------------------
 * Generic provisioner: stands up a Paperclip company with the full
 * pipeline-orchestrator cargo roster (47), installs the 11 custom
 * skills (from THIS plugin's references/paperclip/skills/), hires the
 * cargos and attaches the right skills per category.
 *
 * ID-agnostic and portable: resolves the company by NAME (creates it
 * if absent), captures agent IDs at runtime, and computes all plugin
 * paths from __dirname — no hardcoded UUIDs or machine-specific paths.
 *
 * Agents are created with heartbeat DISABLED (inert until you assign
 * an issue / wake them). Nothing runs automatically.
 *
 * Usage (run where the Paperclip API is reachable, e.g. on the host):
 *   node provision-pipeline-company.cjs ["Company Name"]
 *
 * Env overrides:
 *   PAPERCLIP_API_URL   default http://127.0.0.1:3100/api
 *   PAPERCLIP_COMPANY   company name (default "Pipeline Orchestrator")
 *   PAPERCLIP_ADAPTER   default codex_local
 *   PAPERCLIP_MODEL     default gpt-5.4
 *   PAPERCLIP_CODEX_COMMAND default codex
 *   PAPERCLIP_CWD       agent working dir (default = plugin root)
 *   PAPERCLIP_PLUGIN_ROOT  override plugin root (default = resolved from __dirname)
 * ------------------------------------------------------------------
 */
const path = require('path');
const fs = require('fs');

const API = (process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100/api').replace(/\/$/, '');
const COMPANY_NAME = process.env.PAPERCLIP_COMPANY || process.argv[2] || 'Pipeline Orchestrator';
const ADAPTER = process.env.PAPERCLIP_ADAPTER || 'codex_local';
const MODEL = process.env.PAPERCLIP_MODEL || 'gpt-5.4';
const CODEX_COMMAND = process.env.PAPERCLIP_CODEX_COMMAND || 'codex';

// references/paperclip/scripts/<this> -> references/paperclip is one up
const REF = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REF, 'skills');
const PLUGIN_ROOT = process.env.PAPERCLIP_PLUGIN_ROOT || path.resolve(REF, '..', '..');
const CWD = process.env.PAPERCLIP_CWD || PLUGIN_ROOT;

const OS_SKILL = 'paperclip';
const CORE = ['engineering-principles', 'pipeline-orchestrator-contracts', 'pipeline-orchestrator-iron-laws'];
const CLASS = 'pipeline-orchestrator-classification';
const TDD = 'pipeline-orchestrator-tdd';
const ADVS = 'pipeline-orchestrator-adversarial';
const SPECP = 'pipeline-orchestrator-spec-protocol';
const VSA = 'pipeline-orchestrator-vsa';
const BUGM = 'pipeline-orchestrator-bugfix-method';
const UXM = 'pipeline-orchestrator-ux-method';
const AUDM = 'pipeline-orchestrator-audit-method';

const SKILL_DIRS = [
  'engineering-principles',
  'pipeline-orchestrator-adversarial', 'pipeline-orchestrator-audit-method', 'pipeline-orchestrator-bugfix-method',
  'pipeline-orchestrator-classification', 'pipeline-orchestrator-contracts', 'pipeline-orchestrator-iron-laws',
  'pipeline-orchestrator-spec-protocol', 'pipeline-orchestrator-tdd', 'pipeline-orchestrator-ux-method',
  'pipeline-orchestrator-vsa',
];

const AX = 'PAPERCLIP-AXIOMS.md', SPEC = 'PAPERCLIP-SPEC-WORKFLOW.md', FEAT = 'PAPERCLIP-FEATURE-WORKFLOW.md';
const BUG = 'PAPERCLIP-BUGFIX-WORKFLOW.md', UX = 'PAPERCLIP-UX-WORKFLOW.md', AUD = 'PAPERCLIP-AUDIT-WORKFLOW.md', ADV = 'PAPERCLIP-ADVERSARIAL-WORKFLOW.md';

// [name, role, extraSkills, workflowFile, title]; pipeline-controller MUST be index 0 (org-chart top)
const ROSTER = [
  ['pipeline-controller', 'pm', [CLASS], AX, 'Project Manager / Delivery Lead'],
  ['task-orchestrator', 'pm', [CLASS], AX, 'Intake Coordinator / Triage'],
  ['information-gate', 'pm', [CLASS], AX, 'Business Analyst / Requirements Clarifier'],
  ['sentinel', 'qa', [TDD], AX, 'Compliance Officer / Process Auditor'],
  ['sanity-checker', 'qa', [TDD], AX, 'QA Engineer / Build Verifier'],
  ['checkpoint-validator', 'qa', [TDD], AX, 'Continuous Integration Specialist'],
  ['final-validator', 'pm', [TDD], AX, 'Release Manager / Sign-off Authority'],
  ['finishing-branch', 'devops', [], AX, 'Release Engineer / DevOps'],
  ['brainstorm-controller', 'pm', [CLASS], AX, 'Discovery Workshop Facilitator'],
  ['adversarial-batch', 'security', [ADVS, TDD], AX, 'Security Analyst (per-batch)'],
  ['brainstorm-step-00-intake', 'pm', [SPECP, CLASS], SPEC, 'Discovery Note-Taker'],
  ['brainstorm-step-01-explore', 'pm', [SPECP, CLASS], SPEC, 'Requirements Detective'],
  ['brainstorm-step-01b-alternatives', 'pm', [SPECP, CLASS], SPEC, 'Options Strategist'],
  ['design-interrogator', 'engineer', [CLASS], AX, 'Principal Engineer / Design Reviewer'],
  ['plan-architect', 'engineer', [TDD, SPECP], AX, 'Tech Lead / Implementation Architect'],
  ['quality-gate-router', 'qa', [TDD], AX, 'QA Lead / Test Strategist'],
  ['pre-tester', 'qa', [TDD], AX, 'Test Engineer / TDD Specialist'],
  ['architecture-reviewer', 'engineer', [ADVS], AX, 'Senior Architect (Patterns)'],
  ['diff-discipline-reviewer', 'engineer', [ADVS], AX, 'Scope / Change Control Reviewer'],
  ['review-orchestrator', 'pm', [ADVS], ADV, 'Code Review Lead'],
  ['final-adversarial-orchestrator', 'security', [ADVS], ADV, 'Red Team Coordinator'],
  ['executor-controller', 'pm', [TDD, CLASS], AX, 'Engineering Manager / Sprint Master'],
  ['executor-implementer-task', 'engineer', [TDD], AX, 'Engineer (IC)'],
  ['executor-spec-reviewer', 'engineer', [TDD], AX, 'Spec Reviewer / Requirements Validator'],
  ['executor-quality-reviewer', 'engineer', [TDD], AX, 'Senior IC / Clean Code Reviewer'],
  ['executor-fix', 'engineer', [TDD], AX, 'Remediation Engineer'],
  ['spec-closer', 'pm', [SPECP], AX, 'Project Closure Officer'],
  ['feature-vertical-slice-planner', 'engineer', [VSA, TDD], FEAT, 'Feature Architect (Planning)'],
  ['feature-implementer', 'engineer', [VSA, TDD], FEAT, 'Full-Stack Engineer / Feature Developer'],
  ['feature-integration-validator', 'qa', [VSA, TDD], FEAT, 'Integration QA / Acceptance Tester'],
  ['bugfix-diagnostic-agent', 'engineer', [BUGM, TDD], BUG, 'Production Support / Diagnostician'],
  ['bugfix-root-cause-analyzer', 'engineer', [BUGM, TDD], BUG, 'Root Cause Analyst'],
  ['bugfix-regression-tester', 'qa', [BUGM, TDD], BUG, 'Regression Test Engineer'],
  ['ux-simulator', 'designer', [UXM], UX, 'UX Researcher / Journey Designer'],
  ['ux-accessibility-auditor', 'designer', [UXM], UX, 'Accessibility Specialist'],
  ['ux-qa-validator', 'qa', [UXM], UX, 'UX QA Lead'],
  ['audit-intake', 'researcher', [AUDM], AUD, 'Audit Intake Analyst'],
  ['audit-domain-analyzer', 'researcher', [AUDM], AUD, 'Senior Domain Auditor'],
  ['audit-compliance-checker', 'security', [AUDM], AUD, 'Compliance Auditor'],
  ['audit-risk-matrix-generator', 'researcher', [AUDM], AUD, 'Risk Officer / Report Author'],
  ['adversarial-review-coordinator', 'security', [ADVS], ADV, 'Red Team Lead'],
  ['adversarial-security-scanner', 'security', [ADVS], ADV, 'AppSec Specialist (Independent)'],
  ['adversarial-architecture-critic', 'engineer', [ADVS], ADV, 'Independent Architecture Reviewer'],
  ['adversarial-quality-reviewer', 'engineer', [ADVS], ADV, 'Senior Code Reviewer (Maintainability)'],
  ['spec-format-gate', 'qa', [SPECP], SPEC, 'Spec Format Auditor / Linter'],
  ['spec-content-reviewer', 'qa', [SPECP], SPEC, 'Senior Spec Reviewer'],
  ['spec-post-impl-validator', 'qa', [SPECP], SPEC, 'Spec Implementation Auditor'],
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function shouldRetryRequest(method, status) {
  return isRetryableMethod(method) && isRetryableStatus(status);
}

function apiTimeoutMs() {
  return parsePositiveInt(process.env.PAPERCLIP_API_TIMEOUT_MS, 30_000);
}

function apiRetryAttempts() {
  return parseNonNegativeInt(process.env.PAPERCLIP_API_RETRY_ATTEMPTS, 2);
}

function apiRetryBaseDelayMs() {
  return parsePositiveInt(process.env.PAPERCLIP_API_RETRY_BASE_DELAY_MS, 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTransientError(method, urlPath, cause) {
  const message = cause && cause.message ? cause.message : String(cause || 'unknown error');
  const err = new Error(
    'Paperclip API request failed: ' + method + ' ' + urlPath + ' via ' + API + ' - ' + message,
  );
  err.cause = cause;
  return err;
}

async function api(method, urlPath, body) {
  const timeoutMs = apiTimeoutMs();
  const retryAttempts = apiRetryAttempts();
  const retryBaseDelayMs = apiRetryBaseDelayMs();
  let lastError = null;
  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new Error(
          'timeout after ' + timeoutMs + 'ms for ' + method + ' ' + urlPath + ' via ' + API,
        ),
      );
    }, timeoutMs);

    try {
      const res = await fetch(API + urlPath, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      const result = { status: res.status, json, text };
      if (!shouldRetryRequest(method, res.status) || attempt === retryAttempts) {
        return result;
      }
      lastError = new Error('transient HTTP status ' + res.status + ' for ' + method + ' ' + urlPath);
    } catch (err) {
      lastError = makeTransientError(method, urlPath, err);
      if (!isRetryableMethod(method) || attempt === retryAttempts) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    const delay = retryBaseDelayMs * (attempt + 1);
    console.log('retry ' + (attempt + 1) + '/' + retryAttempts + ' ' + method + ' ' + urlPath + ' after ' + delay + 'ms');
    await sleep(delay);
  }
  throw lastError || new Error('Paperclip API request failed without response: ' + method + ' ' + urlPath);
}

async function ensureCompany() {
  const list = await api('GET', '/companies');
  const found = (list.json || []).find((c) => c.name === COMPANY_NAME && c.status !== 'archived');
  if (found) { console.log('Company exists: ' + COMPANY_NAME + ' (' + found.id + ')'); return found.id; }
  const created = await api('POST', '/companies', { name: COMPANY_NAME, description: 'pipeline-orchestrator infra company (47 cargos)' });
  if (created.status !== 201 || !created.json) { throw new Error('Company create failed: ' + created.status + ' ' + created.text.slice(0, 200)); }
  console.log('Company created: ' + COMPANY_NAME + ' (' + created.json.id + ', prefix ' + created.json.issuePrefix + ')');
  return created.json.id;
}

async function installSkills(companyId) {
  const existing = await api('GET', '/companies/' + companyId + '/skills');
  const have = new Set((existing.json || []).map((s) => s.slug));
  let ok = 0;
  for (const dir of SKILL_DIRS) {
    if (have.has(dir)) { ok++; continue; }
    const src = path.join(SKILLS_DIR, dir);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) { console.log('  skip (no SKILL.md): ' + dir); continue; }
    const r = await api('POST', '/companies/' + companyId + '/skills/import', { source: src });
    if (r.status === 201) ok++; else console.log('  skill import FAIL ' + dir + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
  }
  console.log('Skills present: ' + ok + '/' + SKILL_DIRS.length);
}

function hirePayload(entry, reportsTo) {
  const [name, role, , workflow, title] = entry;
  const p = {
    name, role, title,
    capabilities: title + ' — pipeline-orchestrator cargo (' + name + ')',
    adapterType: ADAPTER,
    adapterConfig: { command: CODEX_COMMAND, model: MODEL, cwd: CWD, instructionsFilePath: path.join(REF, workflow) },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
    budgetMonthlyCents: 0,
    permissions: { canCreateAgents: false },
  };
  if (reportsTo) p.reportsTo = reportsTo;
  return p;
}

function desiredSkillsFor(entry) {
  const [, , extra] = entry;
  return [OS_SKILL].concat(CORE).concat(extra);
}

function reconcilePayload(entry, reportsTo) {
  const payload = {
    ...hirePayload(entry, reportsTo),
    desiredSkills: desiredSkillsFor(entry),
  };
  delete payload.permissions;
  return payload;
}

async function hireAll(companyId) {
  const existing = await api('GET', '/companies/' + companyId + '/agents');
  const byName = {}; (existing.json || []).forEach((a) => { byName[a.name] = a.id; });
  // controller first (top)
  let controllerId = byName['pipeline-controller'];
  if (!controllerId) {
    const r = await api('POST', '/companies/' + companyId + '/agent-hires', hirePayload(ROSTER[0], null));
    controllerId = r.json && (r.json.agent ? r.json.agent.id : r.json.id);
    console.log((controllerId ? 'OK ' : 'FAIL ') + 'pipeline-controller ' + (controllerId || r.text.slice(0, 120)));
    if (!controllerId) throw new Error('pipeline-controller hire failed');
    byName['pipeline-controller'] = controllerId;
  }
  let ok = 1;
  for (let i = 1; i < ROSTER.length; i++) {
    const name = ROSTER[i][0];
    if (byName[name]) { ok++; continue; }
    const r = await api('POST', '/companies/' + companyId + '/agent-hires', hirePayload(ROSTER[i], controllerId));
    const id = r.json && (r.json.agent ? r.json.agent.id : r.json.id);
    if (id) { ok++; byName[name] = id; } else console.log('FAIL ' + name + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
  }
  console.log('Cargos present: ' + ok + '/' + ROSTER.length);
  return byName;
}

async function syncSkills(companyId, agentId, desiredSkills, name) {
  const r = await api(
    'POST',
    '/agents/' + agentId + '/skills/sync?companyId=' + encodeURIComponent(companyId),
    { desiredSkills },
  );
  if (r.status !== 200) {
    console.log('skill sync FAIL ' + name + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
    return false;
  }
  return true;
}

async function reconcileAll(companyId, byName) {
  let ok = 0;
  const controllerId = byName['pipeline-controller'];
  for (let i = 0; i < ROSTER.length; i++) {
    const entry = ROSTER[i];
    const [name] = entry;
    const id = byName[name]; if (!id) continue;
    const reportsTo = i === 0 ? null : controllerId;
    const desiredSkills = desiredSkillsFor(entry);
    const r = await api('PATCH', '/agents/' + id, reconcilePayload(entry, reportsTo));
    if (r.status !== 200 && r.status !== 201) {
      console.log('reconcile FAIL ' + name + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
      continue;
    }
    const synced = await syncSkills(companyId, id, desiredSkills, name);
    if (synced) ok++;
  }
  console.log('Cargos reconciled: ' + ok + '/' + ROSTER.length);
  if (ok !== ROSTER.length) throw new Error('Agent reconcile incomplete: ' + ok + '/' + ROSTER.length);
}

async function main() {
  console.log('Paperclip pipeline-orchestrator provisioner');
  console.log('  API     : ' + API);
  console.log('  Company : ' + COMPANY_NAME);
  console.log('  Adapter : ' + ADAPTER + ' | model ' + MODEL);
  console.log('  Command : ' + CODEX_COMMAND);
  console.log('  Plugin  : ' + PLUGIN_ROOT);
  if (typeof fetch !== 'function') { console.error('FATAL: global fetch unavailable — needs Node 18+'); process.exit(1); }
  const companyId = await ensureCompany();
  await installSkills(companyId);
  const byName = await hireAll(companyId);
  await reconcileAll(companyId, byName);
  console.log('\\nDONE. 47 cargos provisioned (heartbeat OFF — inert until you assign an issue).');
  console.log('Company id: ' + companyId);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
}

module.exports = {
  ROSTER,
  SKILL_DIRS,
  desiredSkillsFor,
  hirePayload,
  reconcilePayload,
  syncSkills,
  api,
  parsePositiveInt,
  parseNonNegativeInt,
  isRetryableStatus,
  isRetryableMethod,
  shouldRetryRequest,
};
