# Requirements — codex-harness-claude-absorption

## Objetivo
Absorver capacidades v4.8 (Hook Enforcement) e v4.9 (Spec Lifecycle) do orchestrator Claude para o SSOT Codex por tradução de runtime, preservando contratos reais do host.

## Requisitos funcionais (EARS)
- **Ubiquitous**: O sistema **deve** bloquear fluxo pipeline-worthy com `blocked-no-agent-runtime` quando `spawn_agent` não estiver disponível.
- **Ubiquitous**: O sistema **deve** distinguir execução real de fallback/simulação/local-validation em logs e mensagens finais.
- **Event-driven**: Quando um skill com frontmatter for carregado, o sistema **deve** validar `agent_type`, `gates_at` e `sentinel_checkpoints` e registrar evento JSONL.
- **Unwanted behavior**: Se frontmatter obrigatório estiver ausente/inválido, o sistema **deve** negar execução (modo deny) e emitir motivo auditável.
- **State-driven**: Enquanto o tipo de pipeline for `Spec`, o sistema **deve** aplicar gates de Spec e rastreabilidade AC↔artefatos.
- **Optional feature**: Onde o usuário selecionar `spec-light`, `spec-heavy` ou `spec-audit-only`, o sistema **deve** executar o fluxo correspondente mantendo os mesmos contratos de segurança.

## Critérios de aceite (ATDD)
1. Dado runtime sem adapter de agente real, quando `/pipeline` exigir agentes reais, então deve falhar com `blocked-no-agent-runtime`.
2. Dado frontmatter inválido, quando hook de dispatch rodar, então deve negar com evento JSONL e exit code de bloqueio.
3. Dado fluxo `Spec`, quando artefato obrigatório faltar, então gate `SPEC_ARTIFACT_MISSING` deve bloquear.
4. Dado batch concluído sem findings abertos, quando revisão adversarial rodar, então loop deve encerrar sem rerun adicional.
