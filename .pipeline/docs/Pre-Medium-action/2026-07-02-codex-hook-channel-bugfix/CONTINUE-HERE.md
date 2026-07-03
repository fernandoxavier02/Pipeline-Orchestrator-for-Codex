# Codex hook channel bugfix — CONCLUÍDO

**Status em 2026-07-03:** TODOS os 3 batches commitados e pushados para origin/main. Batch 1+2 = 41d0286; Batch 3 = 3af7724 (redo, 3 fix rounds → review PASS action=NONE). Cache Codex 0.5.1 sincronizado. Nada pendente exceto follow-ups não-bloqueantes (ver memória `codex-hook-channel-bugfix.md`). O texto abaixo é o histórico de quando o Batch 3 ainda estava pendente.

## O que foi feito (commit 41d0286 em origin/main)

Bug raiz: os hooks do Codex emitiam enforcement só em `systemMessage`/`stopReason` (campos de UI que o modelo NÃO recebe), então bloqueios não diziam ao modelo como desbloquear, e prompts eram mortos.

- **Batch 1 — `hooks/completion-checklist.cjs`** (Stop): short-circuit `{continue:true}` quando `stop_hook_active===true` (anti-loop) + log `allow_stop_hook_active_retry`; bloqueio de Stop agora carrega `{decision:"block", reason}` do schema Codex (reason vira o próximo prompt). Review PASS_WITH_WARNINGS, action=NONE.
- **Batch 2 — `hooks/force-pipeline-agents.cjs`** (UserPromptSubmit): pipeline-worthy → advisory (`continue:true` + `hookSpecificOutput.additionalContext`) em vez de matar o turno; bootstrap só em prefixo explícito `/pipeline-orchestrator-for-codex:`; slash de outro plugin não arma estado. Review PASS, action=NONE.
- Testes: `completion-checklist.test.ts` (122) e `force-pipeline-agents.test.ts` (118), lint limpo, 369/369 em tests/unit/hooks.
- Cache Codex `~/.codex/plugins/cache/fx-studio-ai/pipeline-orchestrator-for-codex/0.5.1` sincronizado (2 hooks). Versão mantida 0.5.1 (path do cache é hard-coded nessa versão; bumpar exigiria mexer no sync script — fora do escopo aprovado).

## Batch 3 — PENDENTE (edit-guard + pipeline-reset)

WIP preservado em: `C:/Users/win/AppData/Local/Temp/claude/.../scratchpad/batch3-wip/` (edit-guard-hook.cjs, edit-guard-hook.test.ts, pipeline-reset.cjs, pipeline-reset.test.ts). Foi REVERTIDO da árvore (tinha CRITICALs abertos). **Não reaproveitar o verb-resolver — a review convergiu que ele é frágil.**

Objetivo do Batch 3 (as "prisões sem saída"): liberar Bash read-only que menciona `.codex/pipeline` (negar só escrita); allowlist de `scripts/exec-window/{open,close}.cjs` + novo `scripts/pipeline-reset.cjs` (rota de escape determinística); corrigir 4 falsos positivos de regex; mensagens de deny com comando executável.

Findings da última review (F1-F7) que a nova abordagem PRECISA fechar sem reintroduzir os 4 falsos positivos (echo "mv a b" / npm install / pip3 install / arrow strings ->,=> / heredoc read-only):
- **F1 (CRIT):** `&` solitário (background) não é separador de segmento → chaining escapa o allowlist.
- **F2 (CRIT):** verbo entre aspas (`"cp"`) não é detectado como escrita.
- **F3 (CRIT):** wrapper com flag (`env -i cp`, `sudo -u root cp`) → retorna a flag, não o verbo.
- **F4 (CRIT):** `bash -c "cp ..."` / `sh -c` escapam (cp/mv/tee/touch/install ficaram fora do match-anywhere).
- **F5 (IMP):** exclusão de `->`/`=>` engole o redirect real `var=>file`.
- **F6 (IMP):** reset não assere que o dir canônico é descendente do cwd → symlink intermediário (`.codex -> /external`) escapa.
- **F7 (IMP):** allowlist aceita segmento com redirection à direita antes de inspecionar o alvo.

**Abordagem recomendada pela review:** manter os write-verbs em match-anywhere E corrigir os 4 falsos positivos por outra via (não estreitar para verb-only). Adicionar testes de negação com os PoCs exatos de F1-F7 (TDD).

## Follow-up separado (fora deste run)
`src/hooks/pipeline-harness.ts:106-114` (`decideFirstMessageHarness`) ainda modela o bootstrap generic-slash removido no Batch 2 — divergência de SSOT (não é bypass vivo; módulo não é importado por runtime). Alinhar com D4 ou remover.

## Estado do run
`sentinel-state.json`: pipeline_active=false, current_phase=PAUSED-after-batch1+2-committed, recuperável. gate-decisions.jsonl tem 2 anomalias de auditoria (linha STEP_1_7_ROUTING com decided_by='step-ledger-stamp'; timestamps manuais fora de ordem) — resíduo dos registros manuais de estado do controller, sem impacto no código commitado.
