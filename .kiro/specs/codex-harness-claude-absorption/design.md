# Design — codex-harness-claude-absorption

## Arquitetura alvo
- **Host Codex**: executa `spawn_agent`.
- **Runtime Node/TS**: classifica, planeja batches, aplica gates, checkpoints, estado e auditoria.
- **Hooks**: enforcement de contrato de skill/frontmatter + políticas deny + telemetria JSONL.

## DDD (limites)
- **Bounded Context Orchestration**: classificação, proposta, batches, sequência.
- **Bounded Context Enforcement**: hooks, parser frontmatter, dispatch guard.
- **Bounded Context Spec Lifecycle**: variantes `spec-*`, gates e artefatos `.kiro/specs/<feature>/`.
- **Bounded Context Auditability**: `gate-decisions.jsonl`, `hook-events.jsonl`, `sentinel-state.json`, closeout.

## Estratégia de loop adversarial por batch
Para cada batch:
1. Planejar escopo pequeno e critérios de pronto.
2. Implementar mínimo (TDD red→green→refactor quando houver código novo).
3. Executar bateria de testes do batch (unit/integration/BDD de contrato).
4. Executar revisão adversarial (qualidade, segurança, contrato).
5. Se houver finding crítico/alto: abrir mini-fix no mesmo batch e repetir passos 2–4.
6. Encerrar batch apenas quando: sem findings críticos/altos + testes verdes + gates aprovados.

## Condição de parada global
O loop adversarial **cessa** quando todos os batches atingirem estado `done` e o gate final confirmar:
- zero finding aberto crítico/alto,
- nenhuma divergência de contrato declarada,
- acceptance pass completo.
