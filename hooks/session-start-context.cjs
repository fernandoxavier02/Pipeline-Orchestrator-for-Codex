#!/usr/bin/env node

const additionalContext = [
  'Pipeline Orchestrator for Codex v0.5.2 loaded.',
  'Use /pipeline-orchestrator-for-codex:pipeline [task] for strict governed execution.',
  'Strict pipeline validity requires real spawn_agent/wait_agent dispatch, gate records, hook checkpoints, artifact collection, and a structured final state.',
  'Without the complete real-agent runtime, operational pipeline execution must end as blocked-no-agent-runtime instead of simulating multi-agent execution.',
].join('\n');

console.log(JSON.stringify({
  continue: true,
  hook_enforcement_mode: 'advisory',
  pipeline_valid: false,
  additionalContext,
}));
