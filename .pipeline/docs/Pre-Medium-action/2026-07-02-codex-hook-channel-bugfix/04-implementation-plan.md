# Phase 1.5: Implementation Plan (plan-architect)

**Timestamp:** 2026-07-03 02:35:00
**Status:** APPROVED (aprovação sob autorização explícita prévia do usuário — "faça o bug fix... commit e push"; AskUserQuestion da Phase 1 sem resposta em 60s/AFK; plano é idêntico à proposta confirmada)
**Agent:** plan-architect a8ed6ac034c2705da (via PLAN_MODE_REQUEST/RESULTS)

## Resumo

3 tasks = 3 batches (COMPLEXA, 1 task/batch), edits aditivos em 3 hooks + 1 script novo + 4 arquivos de teste. Diff budget: ≤8 arquivos, ≤650 linhas.

- **T1** hooks/completion-checklist.cjs — short-circuit `stop_hook_active===true` → `{continue:true}` + recordHookEvent `allow_stop_hook_active_retry` ANTES de evaluateStopEnforcement (~1414); no bloqueio (1429-1442) ADICIONAR `decision:"block"` + `reason:<texto do ramo>` mantendo campos atuais. Testes: completion-checklist.test.ts (cuidado com toEqual exato em :483-484).
- **T2** hooks/force-pipeline-agents.cjs — builders advisory/enforced ganham `hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext:<systemMessage>}`; pipeline-worthy (860-875) vira advisoryOutput (continue:true); detectFirstMessageHarness perde o branch generic-slash (241-249); malformed + catch mantêm continue:false. Testes: force-pipeline-agents.test.ts (9 asserts a atualizar + 4 novos cenários).
- **T3** hooks/edit-guard-hook.cjs + scripts/pipeline-reset.cjs (novo) — 4 fixes de regex (48, 51, 57, 60); tokenizer anti-chaining compartilhado (&&, ;, |, `, $()); allowlist exato de 3 scripts com resolução cwd→PLUGIN_ROOT→CODEX_PLUGIN_ROOT→CLAUDE_PLUGIN_ROOT (padrão dispatch-guard.cjs:705-724); pipeline-reset permitido até sob estado adulterado; menção read-only a .codex/pipeline liberada (negar só escrita); mensagens de deny com path absoluto + JSON quotado; pipeline-reset.cjs apaga exatamente workflow-intent/required-first-actions/sentinel-state/session-lock/session.json + sessions/*.exec-window (nunca ledgers), decision `pipeline_reset`, guarda anti-symlink R13, path-traversal guard. Testes: edit-guard-hook.test.ts + tests/unit/security/pipeline-reset.test.ts (novo).

## CHANGE_CONTRACT (vigente para os 3 batches)

allowed_files: hooks/completion-checklist.cjs, hooks/force-pipeline-agents.cjs, hooks/edit-guard-hook.cjs, tests/unit/hooks/{completion-checklist,force-pipeline-agents,edit-guard-hook}.test.ts
allowed_new_files: scripts/pipeline-reset.cjs, tests/unit/security/pipeline-reset.test.ts
forbidden: package.json, lockfiles, .env, .github/workflows/*, dist/**, .kimi/**, src/**, .codex-plugin/plugin.json (bump é Phase 3)
diff_budget: 8 files / 650 lines (+20% = escalação)

## Riscos-chave

1. (HIGH) Anti-chaining/allowlist é superfície de bypass — matriz de operadores + regressão completa do edit-guard-hook.test.ts.
2. (MED) Nome do campo additionalContext não verificado contra o consumidor real do Codex — espelhar shape hookSpecificOutput já usado no PreToolUse.
3. (MED) toEqual exatos quebram com chaves aditivas — atualizar asserts RED-first no mesmo batch.

Plano integral (task order, cenários RED por batch, bounded contexts) no transcript do plan-architect e replicado no dispatch de cada batch.

## TDD (Step 2b)

Cenários de teste em linguagem plana = seção "RED scenarios" de cada task acima, apresentados ao usuário na Phase 1/1.5. TDD_APPROVAL registrado sob a mesma autorização prévia (usuário AFK; cenários visíveis no transcript; gate logado em gate-decisions.jsonl).
