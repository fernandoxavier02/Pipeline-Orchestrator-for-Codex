# Product Context

## Produto

`pipeline-orchestrator-for-codex` e um plugin para Codex que transforma pedidos livres de desenvolvimento em um fluxo governado. O usuario chama `/pipeline`, o sistema classifica a tarefa, confirma uma proposta e conduz a execucao por fases com gates, testes, revisao adversarial e validacao final.

## Usuario-Alvo

O usuario-alvo e alguem que usa Codex para trabalho real de engenharia e precisa reduzir improviso, falso positivo de validacao e respostas longas sem execucao verificavel.

## Valor Principal

O valor do plugin e confiabilidade operacional: cada etapa deve deixar claro o que foi decidido, o que foi executado, quais evidencias existem e se a entrega e Go, Conditional ou No-Go.

## Experiencia Esperada

O comando `/pipeline` deve ser previsivel:

- classificar tipo, complexidade e severidade;
- detectar lacunas de informacao antes de codar;
- propor o fluxo e aguardar confirmacao;
- executar em batches proporcionais ao risco;
- aplicar revisao adversarial em pontos de controle;
- persistir estado, gates e closeout quando aplicavel.

## Nao Objetivos

O plugin nao deve virar apenas um conjunto de documentos aspiracionais. Tambem nao deve substituir o julgamento do engenheiro: ele organiza evidencias, gates e decisoes, mas precisa reportar incerteza quando o runtime nao consegue garantir algo.
