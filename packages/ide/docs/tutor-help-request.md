# Contrato JSON: pedido de ajuda ao tutor (`TutorHelpRequest`)

Este documento descreve o corpo JSON enviado pelo cliente WebStudio (`@luisricar-do/agent`, método `helpStream` → `POST .../help/stream`) ao sistema multiagente (SMA) **maieutica**. Os tipos TypeScript canónicos estão em [`packages/agent/src/types.ts`](../../agent/src/types.ts).

## Campos principais

| Campo | Descrição |
|-------|-----------|
| `code` | Texto completo do programa no editor (snapshot atual). |
| `errors` | Lista de mensagens **brutas** do compilador/analisador (strings legíveis para o LLM; podem ser omitidas na UI do aluno). |
| `history` | Trocos anteriores da conversa (`role`: `user` \| `assistant`) para o grafo LangGraph. |
| `cursorLine`, `cursorColumn` | Posição 1-based do cursor no Monaco — útil para perguntas situadas e para desenhar a “corda” contextual na IDE. |
| `compilerErrorLines` | Lista opcional de números de **linha** (1-based) com erro de compilação derivados dos marcadores Monaco/worker — correlaciona erro estrutural sem duplicar texto. |
| `astSummary` | Resumo textual curto do estado sintático (ex.: contagem de erros) gerado no frontend. |
| `dataFlowContext` | Texto opcional sobre fluxo de dados / variáveis em atenção (ligações, pendências). |
| `activeTutorDecorations` | Quantidade de decorações pedagógicas ainda visíveis no editor (política de `clear_highlights`). |
| `hintLevel` | Intensidade pedida da dica (1–3). |
| `studentName` | Personalização opcional. |

## Extensão futura

Campos adicionais (ex.: intervalo de seleção explícito, snippet só da região em erro) devem ser acrescentados ao mesmo tipo em **agent**, **IDE** e **maieutica** para manter paridade.
