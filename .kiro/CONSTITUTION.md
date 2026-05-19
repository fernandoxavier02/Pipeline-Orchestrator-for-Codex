# Constitution

Este projeto existe para entregar governanca real para trabalho de software com Codex, nao apenas uma narrativa de processo.

## Principios Obrigatorios

Evidencia acima de suposicao. Uma afirmacao de comportamento so e confiavel quando sustentada por runtime, hook, prompt carregado, teste, log ou artefato persistido.

SSOT acima de conveniencia. Quando duas fontes discordarem, identifique a fonte mais autoritativa e registre o drift antes de corrigir.

Pipeline antes de improviso em trabalho nao trivial. A experiencia esperada e triagem, proposta, confirmacao, execucao em batches, revisao adversarial e validacao final.

Independencia de revisao e requisito de produto. Revisao adversarial nao deve compartilhar o mesmo contexto interno do implementador quando o runtime permitir agentes separados.

Promessas publicas precisam corresponder ao runtime. README, plugin manifest, docs e comandos nao devem anunciar garantias que `skills/**`, `src/**`, `hooks/**` e testes nao executem ou validem.

Eval Gate local e evidencia, nao promessa global. Mudancas em workflow, plugin, skill, hook, command, script, telemetry, gate, trace, batch ou review devem passar pelo runner local antes de qualquer declaracao de PASS. Hooks locais so contam como automaticos quando a confianca em `/hooks` estiver verificada; sem isso, registre telemetry manual.

## Limites de Seguranca

Nunca commitar secrets, tokens, chaves de API ou configuracoes privadas.

Qualquer enforcement de permissao, escrita, dispatch, session lock ou gate precisa ser validado no backend/runtime do plugin, nao apenas descrito em Markdown.

Operacoes destrutivas exigem alvo, impacto e rollback claros antes da execucao.

## Definicao de Pronto

Uma mudanca esta pronta quando:

- o comportamento alterado esta implementado no ponto autoritativo correto;
- testes proporcionais foram rodados ou a impossibilidade foi explicada;
- docs afetados nao contradizem o runtime;
- o diff nao inclui churn gerado ou arquivo fora de escopo sem motivo.
