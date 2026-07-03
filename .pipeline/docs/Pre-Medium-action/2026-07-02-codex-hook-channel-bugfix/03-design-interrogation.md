# Phase 0c: Design Interrogation

**Timestamp:** 2026-07-02 23:15:00
**Session:** 2026-07-02-codex-hook-channel-bugfix
**Status:** SUCCESS — DESIGN_INTERROGATION: PARTIAL (não-bloqueante; 7 recomendações pendentes de confirmação na Phase 1)
**Persistido por:** pipeline-controller (agent a47d96eb27a59af0f, via PLAN_MODE_REQUEST → PLAN_MODE_RESULTS)

## Decisões (9 total: 2 SELF_ANSWERED, 7 RECOMMENDED_PENDING_CONFIRMATION)

| ID | Decisão | Fonte |
|----|---------|-------|
| D1 | Stop anti-loop: `stop_hook_active===true` → allow incondicional + telemetria `allow_stop_hook_active_retry` (sem contador novo, sem estado novo) | RECOMMENDED |
| D2 | `reason` do Stop block: MANTER os dois ramos contextuais existentes (first-actions gap → sequência canônica; artefato → BLOCKED/gates); só adicionar o short-circuit D1 antes | SELF_ANSWERED |
| D3 | force-pipeline-agents: só 2 casos de continue:false (payload malformado; catch interno fail-closed). Pipeline-worthy → advisory com `hookSpecificOutput.additionalContext`. Exclusividade de run ativo é do session-lock-hook (já registrado em UserPromptSubmit) | RECOMMENDED |
| D4 | Slash genérico: bootstrap SÓ para prefixo `/pipeline-orchestrator-for-codex:`. Slash de outro plugin → nada; se o texto for pipeline-worthy → caminho advisory D3 | RECOMMENDED |
| D5a | Reset limpa: 4 protegidos (workflow-intent, required-first-actions, sentinel-state, session-lock) + session.json + sessions/*.exec-window. NUNCA os ledgers assinados (hook-events/gate-decisions.jsonl) nem confidence/fidelity/archives | RECOMMENDED |
| D5b | Reset roda direto, sem --force (caller é agente, não humano; segurança real = allowlist + auditoria) | RECOMMENDED |
| D5c | recordHookEvent decision novo: `pipeline_reset` (aditivo; não conflar com `cleanup`) | RECOMMENDED |
| D5d | Reset toca SÓ .codex/pipeline/* — nunca .pipeline/active-run.json (superfície Claude dev, fora do plugin) | SELF_ANSWERED |
| D6 | Regex Bash: correção cirúrgica dos 4 falsos positivos (`>` precedido de -/=; `install` precedido de package manager; touch/mkdir/cp/mv ancorados a posição de comando; heredoc só em contexto de escrita), reutilizando o tokenizer de separadores do anti-chaining R12. Não reescrever os ~10 padrões saudáveis | RECOMMENDED |

## design_summary

O risco de loop do Stop fecha com allow-com-auditoria em stop_hook_active (o flag existe exatamente para isso). force-pipeline-agents estreita de "casa tudo, bloqueia duro" para "só comandos do próprio plugin; senão advisory" — session-lock-hook já é dono da exclusividade de run ativo. pipeline-reset.cjs limpa exatamente os 5 arquivos que os guards gateiam (nunca ledgers, nunca superfície Claude), roda sem flag e loga `pipeline_reset`. O regex Bash recebe 4 fixes cirúrgicos ancorados em causa-raiz, compartilhando o tokenizer com o anti-chaining do allowlist R12.

Verdict integral (com rationale e evidence por decisão) preservado no transcript do agente e refletido no plano da Phase 1.5.

## Handoff

→ Phase 1 (Proposal): apresentar classificação + as 7 recomendações para confirmação única do usuário.
