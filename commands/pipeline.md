---
description: "Entrypoint oficial do plugin Pipeline Orchestrator for Codex."
allowed-tools: Skill, Read, Bash, Task
argument-hint: [diagnostic|continue|review-only|--simples|--media|--complexa|--hotfix|--grill|--plan] <tarefa>
---

# /pipeline

Execute o workflow oficial do plugin Pipeline Orchestrator for Codex.

## Regra principal

Use a skill `pipeline` fornecida por este plugin como fonte canonica de execucao.
Nao dependa de skills globais legadas com o mesmo nome.

## Fluxo

1. Use a skill `pipeline`.
2. Passe `$ARGUMENTS` como entrada inicial.
3. Se o trabalho for nao trivial, preserve o fluxo oficial:
   - triagem automatica
   - proposta + confirmacao do usuario
   - execucao em batches com TDD
   - revisao adversarial por batch
   - closure + validacao final
4. Preserve os modos oficiais:
   - `FULL`
   - `DIAGNOSTIC`
   - `CONTINUE`
   - `REVIEW-ONLY`
   - `HOTFIX`
5. Preserve os gates oficiais:
   - information-gate
   - confirmacao do usuario
   - quality gate
   - micro-gate
   - adversarial gate
   - final validation

## Checklist minimo

Crie imediatamente um checklist visivel com `update_plan` contendo, nesta ordem:

- `Triagem automática`
- `Proposta + confirmação do usuário`
- `Execução em batches`
- `Closure + validation final`
