# Patterns

## Fonte Certa Para Cada Mudanca

Mudancas de UX do comando `/pipeline`: comece por `commands/pipeline.md` e `skills/pipeline/SKILL.md`, mas mantenha `commands/pipeline.md` como entrypoint curto.

Mudancas de fase, gate, stop rule ou closeout: procure primeiro `src/controller/**`, `src/gates/**`, `src/state/**`, `src/validation/**` e os testes de integracao correspondentes.

Mudancas em agentes: atualize o contrato em `agents/**` ou `prompts/**` e rode testes de inventario/frontmatter/paridade quando existirem.

Mudancas em referencias: trate `references/**` como dados de runtime. Uma alteracao aparentemente pequena pode mudar roteamento de pipeline.

## Padrao de Implementacao

Prefira funcoes pequenas, tipos explicitos e validacao por Zod nas fronteiras de dados persistidos.

Use objetos imutaveis ou retornos novos quando estiver transformando estado de sessao, gate log ou confidence score.

Evite acoplar controller a detalhes de agente. O controller decide fase, estado e transicao; agentes e prompts carregam responsabilidade especializada.

## Padrao de Teste

Para bug fix, reproduza a falha com teste focado antes de corrigir quando for viavel.

Para fluxo de pipeline, prefira teste de integracao que observa o comportamento do controller em vez de testar apenas helper interno.

Para hooks CJS, use teste CJS com `require()` ou spawn de processo quando import ESM/TS nao representar o runtime real.

## Anti-Padroes

Nao adicionar promessa no README sem enforcement ou teste correspondente.

Nao duplicar regras completas em `commands/pipeline.md` se elas pertencem ao skill ou ao runtime TypeScript.

Nao editar `dist/**` como fonte primaria.

Nao concluir que marketplace ou cache esta atualizado sem verificar caminho efetivo, git e resolucao local.
