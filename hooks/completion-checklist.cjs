#!/usr/bin/env node
/**
 * Hook: completion-checklist.cjs (Codex port)
 * Event: Stop
 *
 * When the agent attempts to stop, verifies that minimum requirements
 * were met according to pipeline orchestrator rules:
 *   - ORCHESTRATOR_DECISION emitted
 *   - Build/tests passed
 *   - Pipeline phases completed (if /pipeline-orchestrator-for-codex:pipeline was invoked)
 *
 * Generic — works with any project. Project-specific commands should
 * be configured in .codex/pipeline.local.md
 *
 * Ported from Claude Code pipeline-orchestrator v3.2.0
 * Adapted: .kiro/ paths kept (project-level), .codex/ for plugin config
 */

const fs = require('fs');
const path = require('path');
const { recordHookEvent } = require('./hook-events.cjs');

const REQUIRED_PIPELINE_GATES = [
  'CAPABILITY_GATE',
  'INTAKE_GATE',
  'SCOPE_GATE',
  'EVIDENCE_GATE',
  'ADVERSARIAL_GATE',
  'FINAL_VERDICT_GATE',
];

const CHECKPOINT_PHASES = [
  'intake',
  'planning',
  'agent_dispatch',
  'artifact_collection',
  'adversarial_review',
  'final_verdict',
];

const REQUIRED_PIPELINE_HOOKS = CHECKPOINT_PHASES.flatMap((phase) => [
  `${phase}:before`,
  `${phase}:after`,
]);

const GOVERNANCE_ARTIFACT_FILES = [
  'pipeline-governance-artifact.json',
  'governance-artifact.json',
  'final-governance-artifact.json',
];

function parsePayload(raw) {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return undefined;
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readJsonlIfExists(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function readCheckpointLedger(stateDir) {
  const checkpointDir = path.join(stateDir, 'checkpoints');
  try {
    if (!fs.existsSync(checkpointDir)) return [];
    return fs.readdirSync(checkpointDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .flatMap((entry) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(checkpointDir, entry.name), 'utf8'))];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function collectText(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => collectText(entry, depth + 1)).join('\n');
  if (typeof value === 'object') {
    return Object.values(value).map((entry) => collectText(entry, depth + 1)).join('\n');
  }
  return '';
}

function readTranscriptText(payload) {
  const transcriptPath = typeof payload.transcript_path === 'string'
    ? payload.transcript_path
    : typeof payload.transcriptPath === 'string'
      ? payload.transcriptPath
      : undefined;
  if (!transcriptPath) return '';
  try {
    const resolved = path.resolve(transcriptPath);
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 2_000_000) return '';
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return '';
  }
}

function pipelineWasExplicitlyRequested(payload, rawText, stateDir) {
  if (/\/pipeline-orchestrator-for-codex:pipeline\b/u.test(rawText)) return true;
  const sentinel = readJsonIfExists(path.join(stateDir, 'sentinel-state.json'));
  if (sentinel && sentinel.pipelineActive === true) return true;
  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  return !!(
    session
    && (
      session.pipeline_requested === true
      || typeof session.run_id === 'string'
      || typeof session.sessionId === 'string'
      || typeof session.currentPhase === 'string'
    )
  );
}

function outputAttemptsPipelineCompletion(rawText) {
  return /\bPIPELINE COMPLETE\b/u.test(rawText)
    || /pipeline_valid\s*["':=]\s*true/u.test(rawText)
    || /Final decision:\s*(?:GO|CONDITIONAL)/u.test(rawText);
}

function arrayContainsPass(items, key, id) {
  return Array.isArray(items)
    && items.some((item) => item && item[key] === id && item.status === 'PASS');
}

function collectLedgerStrings(value, depth = 0) {
  if (depth > 8 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((entry) => collectLedgerStrings(entry, depth + 1));
  if (typeof value === 'object') return Object.values(value).flatMap((entry) => collectLedgerStrings(entry, depth + 1));
  return [];
}

function ledgerHasAnyString(value, expected) {
  const strings = collectLedgerStrings(value);
  return expected.some((entry) => strings.includes(entry));
}

function ledgerGatePassed(gate, ledgers) {
  return ledgers.gateDecisions.some((entry) => (
    entry
    && entry.gate === gate
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
  ));
}

function ledgerCheckpointPassed(checkpoint, ledgers) {
  return ledgers.checkpoints.some((entry) => (
    entry
    && entry.name === checkpoint
    && ['completed', 'PASS', 'pass'].includes(entry.status)
  ));
}

function ledgerHookEventPassed(checkpoint, ledgers) {
  return ledgers.hookEvents.some((entry) => (
    entry
    && ['pass', 'PASS', 'approved', 'APPROVED', 'confirmed', 'CONFIRMED'].includes(entry.decision || entry.status)
    && ledgerHasAnyString(entry, [
      checkpoint,
      `hook:${checkpoint}`,
      `checkpoint:${checkpoint}`,
    ])
  ));
}

function ledgerHookPassed(checkpoint, ledgers) {
  return ledgerCheckpointPassed(checkpoint, ledgers) && ledgerHookEventPassed(checkpoint, ledgers);
}

function dispatchRefTokens(role, dispatchRef) {
  const normalizedRef = typeof dispatchRef === 'string' && dispatchRef.startsWith('dispatch:')
    ? dispatchRef.slice('dispatch:'.length)
    : dispatchRef;
  return [role, dispatchRef, normalizedRef, `dispatch:${role}`].filter(Boolean);
}

function ledgerDispatchCompleted(agent, ledgers) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && (typeof entry.event_id !== 'string' || !entry.event_id.endsWith('-wait-agent-completed'))
    && ledgerHasAnyString(entry, dispatchRefTokens(agent.role, agent.dispatch_ref))
  ));
}

function ledgerWaitAgentCompleted(agent, ledgers) {
  return ledgers.protocolEvents.some((entry) => (
    entry
    && entry.kind === 'DISPATCH_REQUEST'
    && entry.status === 'completed'
    && entry.dispatchMode === 'real'
    && typeof entry.event_id === 'string'
    && entry.event_id.endsWith('-wait-agent-completed')
    && entry.payload
    && entry.payload.event === 'WAIT_AGENT_COMPLETED'
    && entry.payload.capability === 'wait_agent'
    && ledgerHasAnyString(entry, [
      ...dispatchRefTokens(agent.role, agent.dispatch_ref),
      `wait_agent:${agent.role}`,
    ])
  ));
}

function validateLedgerEvidence(artifact, ledgers) {
  const missing = [];
  for (const gate of Array.isArray(artifact.gates) ? artifact.gates : []) {
    if (gate && gate.status === 'PASS' && !ledgerGatePassed(gate.gate, ledgers)) {
      missing.push(`ledger:gate:${gate.gate}`);
    }
  }
  for (const hook of Array.isArray(artifact.hooks) ? artifact.hooks : []) {
    if (hook && hook.status === 'PASS' && !ledgerHookPassed(hook.checkpoint, ledgers)) {
      missing.push(`ledger:hook:${hook.checkpoint}`);
    }
  }
  for (const agent of Array.isArray(artifact.agents) ? artifact.agents : []) {
    if (!agent || agent.status !== 'PASS') continue;
    if (!ledgerDispatchCompleted(agent, ledgers)) {
      missing.push(`ledger:dispatch:${agent.role}`);
    }
    if (!ledgerWaitAgentCompleted(agent, ledgers)) {
      missing.push(`ledger:wait_agent:${agent.role}`);
    }
  }
  return missing;
}

function readLedgers(stateDir) {
  return {
    protocolEvents: readJsonlIfExists(path.join(stateDir, 'protocol-events.jsonl')),
    gateDecisions: readJsonlIfExists(path.join(stateDir, 'gate-decisions.jsonl')),
    hookEvents: readJsonlIfExists(path.join(stateDir, 'hook-events.jsonl')),
    checkpoints: readCheckpointLedger(stateDir),
  };
}

function validateGovernanceArtifact(artifact, ledgers = undefined) {
  const missing = [];
  if (!artifact || typeof artifact !== 'object') {
    return {
      ok: false,
      missing: [
        'PipelineGovernanceArtifact',
        ...REQUIRED_PIPELINE_GATES.map((gate) => `gate:${gate}`),
        ...REQUIRED_PIPELINE_HOOKS.map((hook) => `hook:${hook}`),
        'agent:primary_reviewer',
        'agent:adversarial_reviewer',
        'final_verdict:PASS',
      ],
    };
  }
  if (artifact.pipeline_requested !== true) missing.push('pipeline_requested');
  if (artifact.pipeline_valid !== true) missing.push('pipeline_valid');
  if (artifact.runtime_mode !== 'real-agent') missing.push('runtime_mode:real-agent');
  if (artifact.hook_enforcement_mode !== 'blocking') missing.push('hook_enforcement_mode:blocking');
  if (artifact.status !== 'PASS') missing.push('status:PASS');
  if (artifact.manual_fallback_counts_as_pipeline !== false) missing.push('manual_fallback_counts_as_pipeline:false');
  if (!artifact.final_verdict || artifact.final_verdict.status !== 'PASS') missing.push('final_verdict:PASS');

  for (const gate of REQUIRED_PIPELINE_GATES) {
    if (!arrayContainsPass(artifact.gates, 'gate', gate)) missing.push(`gate:${gate}`);
  }

  for (const hook of REQUIRED_PIPELINE_HOOKS) {
    if (!arrayContainsPass(artifact.hooks, 'checkpoint', hook)) missing.push(`hook:${hook}`);
  }

  const agents = Array.isArray(artifact.agents) ? artifact.agents : [];
  for (const role of ['primary_reviewer', 'adversarial_reviewer']) {
    if (!agents.some((agent) => agent && agent.role === role && agent.status === 'PASS' && agent.independent === true)) {
      missing.push(`agent:${role}`);
    }
  }

  if (missing.length === 0 && ledgers) {
    missing.push(...validateLedgerEvidence(artifact, ledgers));
  }

  return { ok: missing.length === 0, missing };
}

function findGovernanceArtifact(payload, stateDir) {
  const fromPayload = payload.pipelineGovernanceArtifact
    || payload.governanceArtifact
    || payload.pipeline_governance_artifact
    || (payload.output && typeof payload.output === 'object' ? payload.output.pipelineGovernanceArtifact : undefined)
    || (payload.output && typeof payload.output === 'object' ? payload.output.governanceArtifact : undefined)
    || (payload.output && typeof payload.output === 'object' ? payload.output.pipeline_governance_artifact : undefined);
  if (fromPayload && typeof fromPayload === 'object') return fromPayload;

  for (const file of GOVERNANCE_ARTIFACT_FILES) {
    const candidate = readJsonIfExists(path.join(stateDir, file));
    if (candidate && typeof candidate === 'object') return candidate;
  }

  const session = readJsonIfExists(path.join(stateDir, 'session.json'));
  if (session && typeof session === 'object') {
    if (session.pipelineGovernanceArtifact && typeof session.pipelineGovernanceArtifact === 'object') {
      return session.pipelineGovernanceArtifact;
    }
    if (session.governanceArtifact && typeof session.governanceArtifact === 'object') {
      return session.governanceArtifact;
    }
  }

  return undefined;
}

function evaluateStopEnforcement(payload, rawInput) {
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const stateDir = path.join(cwd, '.codex', 'pipeline');
  const transcriptText = readTranscriptText(payload);
  const rawText = [rawInput, collectText(payload), transcriptText].join('\n');
  if (!pipelineWasExplicitlyRequested(payload, rawText, stateDir) || !outputAttemptsPipelineCompletion(rawText)) {
    return { ok: true, missing: [] };
  }

  const validation = validateGovernanceArtifact(findGovernanceArtifact(payload, stateDir), readLedgers(stateDir));
  return validation.ok ? { ok: true, missing: [] } : validation;
}

/**
 * Detecta se alguma spec com audit_source existe no projeto.
 * Retorna lista de specs de auditoria encontradas.
 */
function findAuditSourcedSpecs() {
  const specsDir = path.join(process.cwd(), '.kiro', 'specs');
  const found = [];
  try {
    if (!fs.existsSync(specsDir)) return found;
    const dirs = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const specJsonPath = path.join(specsDir, dir.name, 'spec.json');
      try {
        if (!fs.existsSync(specJsonPath)) continue;
        const specJson = JSON.parse(fs.readFileSync(specJsonPath, 'utf8'));
        // Only flag specs that are not yet closed/completed and have audit_source
        if (specJson.audit_source && specJson.phase !== 'closed') {
          found.push({
            name: dir.name,
            audit_source: specJson.audit_source,
            phase: specJson.phase || 'unknown'
          });
        }
      } catch { /* ignore parse errors */ }
    }
  } catch { /* ignore fs errors */ }
  return found;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const payload = parsePayload(input);
    const stopEnforcement = evaluateStopEnforcement(payload, input);
    if (!stopEnforcement.ok) {
      recordHookEvent({
        hook: 'completion-checklist',
        event: 'Stop',
        decision: 'block_missing_governance_artifact',
        reason: 'explicit pipeline completion attempted without validated governance artifact',
      });

      console.log(JSON.stringify({
        continue: false,
        stopReason: `Pipeline completion blocked: missing governance evidence: ${stopEnforcement.missing.join(', ')}`,
        systemMessage: [
          'PIPELINE STOP ENFORCEMENT: explicit pipeline completion requires a validated PipelineGovernanceArtifact.',
          'Emit BLOCKED with pipeline_valid=false, or complete the missing gates/hooks/agent artifacts before finalizing.',
        ].join('\n'),
      }));
      return;
    }

    const contextParts = [
      '## Checklist de Conclusao (auto-injetado)',
      '',
    ];

    // Kiro-specific rules — only include if .kiro directory exists
    const kiroDir = path.join(process.cwd(), '.kiro');
    if (fs.existsSync(kiroDir)) {
      contextParts.push(
        '### Regras Inegociaveis (.kiro/steering/golden-rule.md)',
        '- [ ] Regra 1: Spec → Design → Tasks antes de codigo?',
        '- [ ] Regra 2: Evidencia acima de suposicao?',
        '- [ ] Regra 3: Mudanca minima, diff minimo?',
        '- [ ] Regra 5: SSOT — regras criticas no backend?',
        '- [ ] Regra 10: Build obrigatorio, max 2 tentativas?',
        '- [ ] Regra 15: Nao-Invencao — lacunas preenchidas sem perguntar?',
        '- [ ] Regra 16: Execucao Nao-Assumptiva — so o que foi pedido?',
        '',
        '### SSOT (.kiro/steering/authority-map.md)',
        '- [ ] Dominio tocado tem SSOT unica? (recusa se 2 fontes detectadas)',
        '',
      );
    }

    contextParts.push(
      '### Pipeline',
      '- [ ] ORCHESTRATOR_DECISION emitido no inicio?',
      '',
      '### Qualidade',
      '- [ ] Build/validacao executada? (use o comando de build do projeto)',
      '- [ ] Testes executados (se existirem)? (use o comando de test do projeto)',
      '- [ ] Testes passaram? TDD RED->GREEN se implementou codigo',
      '- [ ] Sem regressoes? Suite de regressao do CHECKPOINT passa',
    );

    // v2.0: Check for audit-sourced specs
    const auditSpecs = findAuditSourcedSpecs();
    if (auditSpecs.length > 0) {
      contextParts.push('');
      contextParts.push('### Coverage Gate — Specs de Auditoria (OBRIGATORIO)');
      contextParts.push(`Specs de auditoria detectadas: ${auditSpecs.map(s => s.name).join(', ')}`);
      contextParts.push('');
      for (const spec of auditSpecs) {
        contextParts.push(`**${spec.name}** (fase: ${spec.phase}, audit: ${spec.audit_source})`);
      }
      contextParts.push('');
      contextParts.push('- [ ] Coverage Gate emitido? (tabela gap→AC→task, TODOS os gaps cobertos)');
      contextParts.push('- [ ] Priority Consistency? (gap P0 nunca em slice P2)');
      contextParts.push('- [ ] /kiro:validate-spec rodado? (12 eixos de conteudo, alem do Spec Gate de formato)');
      contextParts.push('');
      contextParts.push('Se qualquer item acima NAO foi cumprido, complete antes de finalizar.');
      contextParts.push('Ref: memory/spec-from-audit-checklist.md');
    }

    // v3.0: Pipeline phase enforcement (always inject — approach B)
    contextParts.push('');
    contextParts.push('### Pipeline Orchestrator — Fases Obrigatorias');
    contextParts.push('Se /pipeline-orchestrator-for-codex:pipeline foi invocado nesta sessao, TODAS as fases devem ter sido executadas:');
    contextParts.push('- [ ] Phase 0: task-orchestrator spawnado (CLASSIFICATION emitida)?');
    contextParts.push('- [ ] Phase 0: information-gate spawnado (INFORMATION_GATE emitida)?');
    contextParts.push('- [ ] Phase 1: PIPELINE PROPOSAL apresentado e usuario confirmou?');
    contextParts.push('- [ ] Phase 2: executor-controller spawnado com batch execution?');
    contextParts.push('- [ ] Phase 2: checkpoint-validator rodou (build + test)?');
    contextParts.push('- [ ] Phase 3: sanity-checker spawnado com evidencia de comando + output?');
    contextParts.push('- [ ] Phase 3: final-validator (Pa de Cal) emitiu GO/CONDITIONAL/NO-GO?');
    contextParts.push('- [ ] Phase 3: finishing-branch apresentou opcoes de closeout?');
    contextParts.push('- [ ] Gate decisions logadas em gate-decisions.jsonl?');
    contextParts.push('- [ ] Artefato final estruturado emitido com pipeline_requested, pipeline_valid, gates, hooks, agents, manual_fallback e final_verdict?');
    contextParts.push('- [ ] CAPABILITY_GATE e FINAL_VERDICT_GATE presentes antes de qualquer PASS?');
    contextParts.push('- [ ] Phase transition summaries emitidos entre cada fase?');
    contextParts.push('');
    contextParts.push('Se /pipeline-orchestrator-for-codex:pipeline NAO foi invocado, ignore esta secao.');
    contextParts.push('Se alguma fase foi pulada, PARE e complete antes de finalizar.');

    contextParts.push('');
    contextParts.push('Se algum item nao foi cumprido, considere completar antes de finalizar.');
    contextParts.push('Se build falhou 2x: PARAR e analisar causa raiz (Stop Rule).');

    recordHookEvent({
      hook: 'completion-checklist',
      event: 'Stop',
      decision: 'inject_completion_checklist',
      reason: 'stop hook checklist emitted',
    });

    console.log(JSON.stringify({
      continue: true,
      additionalContext: contextParts.join('\n')
    }));

  } catch (e) {
    console.log(JSON.stringify({ continue: true }));
  }
});
