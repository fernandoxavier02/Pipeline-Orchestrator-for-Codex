# Tasks: Pipeline Meta IFRS16 Modalities Audit

## Audit Tasks

- [x] Levantar contratos publicos do Pipeline Orchestrator.
- [x] Criar branch temporaria no IFRS16: `codex/meta-pipeline-audit-20260518`.
- [x] Criar worktrees separados por modalidade em `D:\IFRS-16-pipeline-meta-20260518`.
- [x] Rodar build do Orchestrator antes da matriz: `npm run build`.
- [x] Executar prompts simulados para modos publicos, modo documentado nao reconhecido e comandos diretos.
- [x] Comparar saidas contra contratos de gates, hooks, workflows e runtime.
- [x] Registrar achados nesta spec.
- [x] Adicionar comparacao canonica sobre subagentes, fases/gates e brainstorm Step 1.7.
- [x] Remover worktrees temporarios criados nesta auditoria.
- [x] Remover branch temporaria do IFRS16.

## Follow-up Implementation Tasks

- [ ] Corrigir `continue` sem estado para retornar bloqueio estruturado.
- [ ] Restaurar/provar dispatch operacional com `spawn_agent` para controller e subagentes.
- [ ] Revalidar fases 0, 1, 1.5, 2 e 3 com gates persistidos.
- [ ] Restaurar/provar brainstorm Step 1.7 para MEDIA/COMPLEXA/Spec.
- [ ] Decidir se `--no-plan` sera implementado ou removido da documentacao.
- [ ] Fazer `review-only` sempre persistir relatorio ou bloqueio auditavel.
- [ ] Garantir `NEXT_STEP` em todos os estados terminais.
- [ ] Alinhar `protocol-events.jsonl` com o contrato de protocolo ou ajustar a documentacao do harness.
- [ ] Corrigir `execution_identity.cwd` para apontar ao workspace alvo.
- [ ] Documentar oficialmente comandos diretos aceitos pelo parser.
