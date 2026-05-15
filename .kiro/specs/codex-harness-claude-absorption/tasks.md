# Tasks — execução em batches

## Batch 0 — Spec bootstrap (ATDD-first)
- Criar `requirements.md`, `design.md`, `tasks.md`.
- Definir cenários ATDD em linguagem Given/When/Then para contratos centrais.
- Revisão adversarial: consistência SSOT vs promessas.
- AC coverage: AC1, AC2, AC3, AC4.

## Batch 1 — Hook Enforcement v4.8
- TDD: testes vermelhos para parser/guard e modo deny.
- Implementar/ajustar parser frontmatter + `dispatch-guard` + wiring `hooks.json`.
- Revisão adversarial: bypass de validação, falsos positivos e logging auditável.

## Batch 2 — Hardening de hooks existentes
- TDD de telemetria e compatibilidade com `currentSkill/currentStep`.
- Ajustar `sentinel-hook`, `force-pipeline-agents`, `completion-checklist`.
- Revisão adversarial: spoofing de contexto, escrita resiliente JSONL.

## Batch 3 — Tipo `Spec` no domínio
- TDD: tipos/schemas/classifier/controller para `type=Spec` com fallback seguro.
- DDD: manter fronteiras runtime vs host sem acoplamento indevido.
- Revisão adversarial: regressões em tipos legados.

## Batch 4 — Agentes/prompts Spec + gates
- TDD para gates `SPEC_*` e checkpoints adversariais.
- Adicionar prompts/agentes `spec-format-gate`, `spec-content-reviewer`, `spec-post-impl-validator`, `spec-closer`.
- Revisão adversarial: cobertura de rastreabilidade EARS/AC.

## Batch 5 — Skills progressivas + entrypoints
- Implementar `spec-light`, `spec-heavy`, `spec-audit-only` com frontmatter explícito.
- Atualizar `/pipeline-orchestrator-for-codex:pipeline` e avaliar `/pipeline-orchestrator-for-codex:spec` (entrypoint fino) se manifesto suportar.
- Revisão adversarial: discoverability sem inflar comando principal.

## Batch 6 — Testes BDD/integração + docs de release
- BDD para variantes spec e ausência de `spawn_agent`.
- Integração de retomada sentinel e bloqueios de gate.
- Atualizar README/CHANGELOG/manifest com limitações reais do host.
- Revisão adversarial final: evidências de não-simulação e honestidade operacional.

## Batch 7 — Acceptance + fechamento
- Rodar: `npm run lint:types`, `npm run build`, `npm test`.
- Auditar JSONL e relatórios finais.
- Encerrar loop adversarial global ao satisfazer condição de parada.
