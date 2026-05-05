# Repository Structure

## Raiz

- `README.md`: apresentacao publica do plugin.
- `package.json`: scripts, dependencias e versao npm/local.
- `.codex-plugin/plugin.json`: manifest do plugin Codex.
- `.gitignore`: ignora build, estado local e worktrees.

## Runtime e Contratos

- `skills/pipeline/SKILL.md`: contrato operacional principal do skill.
- `commands/pipeline.md`: entrypoint `/pipeline`.
- `src/controller/**`: classificacao, proposta, modos e controller.
- `src/execution/**`: batches, pre-test, checkpoint e execucao.
- `src/gates/**`: information gate, micro gate, hardness e confidence.
- `src/dispatcher/**`: adaptadores de execucao de papeis/agentes.
- `src/state/**`: persistencia de sessao, checkpoint, gate log e confidence.
- `src/review/**`: revisao adversarial e final.
- `src/security/**`: guardas contra injecao e enforcement relacionado.
- `src/validation/**`: validacao final.

## Biblioteca de Agentes e Prompts

- `agents/core/**`: triagem, information gate, checkpoint, sanity e finalizacao.
- `agents/executor/**`: implementacao, fix, spec review e quality review.
- `agents/quality/**`: plano, pre-test, arquitetura e revisao.
- `prompts/**`: prompt bundle consumido pelo runtime.

## Referencias

- `references/complexity-matrix.md`: classificacao e dureza.
- `references/pipelines/**`: variantes de pipeline.
- `references/gates/**`: perguntas e checklists de gate.
- `references/checklists/**`: checklists por dominio.
- `references/glossary.md`: vocabulario compartilhado.

## Documentacao

- `docs/pipeline-orchestrator-codex/**`: arquitetura, gap analysis, blueprint e inventario.
- `docs/superpowers/specs/**`: specs historicas de design.
- `docs/superpowers/plans/**`: planos historicos.
- `docs/audits/**`: evidencias de auditoria.

Docs explicam contexto e decisoes, mas nao substituem runtime nem testes.

## Testes

- `tests/unit/**`: contratos pequenos e logica de modulo.
- `tests/integration/**`: fluxo entre controller, runtime, modos e referencias.
- `tests/bdd/**`: cenarios de comportamento.

Ao alterar um fluxo, procure primeiro testes existentes na area equivalente e preserve o estilo local.
