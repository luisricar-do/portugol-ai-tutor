<a href="https://portugol.dev/"><img src="./packages/ide/src/assets/lightbulb.svg" width="123px" alt="Portugol Webstudio" align="right"></a>

# Portugol Webstudio

_IDE online para o Portugol_

[![Licença](https://img.shields.io/badge/licen%C3%A7a-GPL-blue.svg)](https://github.com/dgadelha/Portugol-Webstudio/blob/master/LICENSE)
[![Stars](https://img.shields.io/github/stars/dgadelha/Portugol-Webstudio)](https://github.com/dgadelha/Portugol-Webstudio/stargazers)

## Dissertação (UNIFEI) — fork `portugol-ai-tutor`

Este repositório é um **fork** de [Portugol-Webstudio](https://github.com/dgadelha/Portugol-Webstudio) usado no mestrado em Ciência e Tecnologia da Computação (UNIFEI — Itajubá), no projeto de dissertação *Orquestração de Agentes de IA com Método Socrático para o Ensino de Lógica de Programação: uma integração com o Portugol Webstudio baseada em Design Science Research* (orientação: Prof. Dr. Bruno Guazzelli Batista).

- **Autor do fork / pesquisa:** Luis Ricardo Albano Santos
- **Upstream:** `https://github.com/dgadelha/Portugol-Webstudio.git` (remote sugerido: `upstream`)
- **Backend (Azure Functions + LangGraph):** repositório companheiro [**maieutica**](https://github.com/luisricar-do/maieutica). Esta IDE inclui o tutora socrática **ADA** em **overlay imersivo** (atalho **⌘⇧A** / **Ctrl+Shift+A** e botão na barra lateral), consumindo `/api/help/stream` em modo SSE. Quando a API sinaliza problema resolvido (`tutorMeta.suggestedConversationEnd`), a conversa é arquivada e inicia-se um fio novo, com opção de reabrir a anterior.

### Sincronizar com o upstream

```sh
git fetch upstream
git checkout develop   # ou a branch em que você trabalha
git merge upstream/main
# resolva conflitos se houver, teste com npm ci && npm run build && npm start
```

O restante deste README descreve o projeto original **Portugol Webstudio**; a licença e os créditos dos autores originais permanecem inalterados abaixo.

---

Baseado no Portugol Studio, o **Portugol Webstudio** tenta trazer todo ambiente de desenvolvimento que é possível se encontrar no desktop, para a internet. Ele constitui-se de um ambiente de desenvolvimento construído para permitir a criação e a execução dos programas escritos em Portugol, trazendo assim uma experiência o mais próxima do que você pode encontrar da IDE do Portugol Studio. Portugol, também conhecido como Português estruturado, é um pseudocódigo escrito em português.

[![Captura de Tela](.github/screenshot.png)](https://portugol.dev/)

## Características

- Suporta abertura e escrita de arquivos `.por`
- Permite editar e executar múltiplos códigos ao mesmo tempo
- Executado no console original do Portugol com interação em tempo real
- Interface simples e idêntica ao Portugol Studio
- Código executado diretamente no navegador através de Web Workers

## Estrutura do projeto

O Portugol Webstudio é um projeto que utiliza o framework [Angular](https://angular.io/), [RxJS](https://rxjs.dev/) e [antlr4ng](https://github.com/mike-lischke/antlr4ng). Ele é dividido em 8 pacotes (disponíveis na pasta `packages`):

- `@luisricar-do/agent`: Cliente TypeScript para a API do tutor (`/api/help` e `/api/help/stream` via SSE), tipos compartilhados, normalização da URL base, a fila durável de telemetria e a classificação das mensagens do compilador; usado pela IDE.
- `@luisricar-do/antlr`: Pacote que contém a gramática do Portugol e a geração do parser, lexer e visitor
- `@luisricar-do/ide`: Pacote que contém a interface do usuário
- `@luisricar-do/parser`: Pacote que contém o novo parser do Portugol, que recebe uma árvore pré-processada pelo ANTLR e a transforma em uma árvore semântica
- `@luisricar-do/resources`: Pacote que contém os recursos do Portugol, como os exemplos e a seção de ajuda
- `@luisricar-do/runner`: Pacote que executa o código gerado pelo transpilador em Web Workers, tratando entrada, saída, erros e eventos. Inclui também o executor **headless** em Node (`PortugolNodeRunner`, `runPortugolProgram` e a CLI `lib/headless/cli.js`), usado pela avaliação da dissertação.
- `@luisricar-do/runtime`: Pacote que contém o transpilador de Portugol para JavaScript e o código de execução em _runtime_ necessário: variáveis, bibliotecas, etc.
- `@luisricar-do/worker`: Pacote que contém o código que será executado em Web Workers, que é responsável por receber o código do Portugol, e executar a verificação de erros e transpilação do código em uma _thread_ separada.

## Executando o código localmente

1. Certifique-se de possuir instalado o [Node.js LTS](https://nodejs.org/pt-br/download/)

2. Instale as dependências do projeto

```sh
npm ci
```

3. Compile os pacotes:

```sh
npm run build
```

4. Inicie o servidor de desenvolvimento:

```sh
npm start
```

Após isto, você poderá acessar a IDE em: [http://localhost:4200](http://localhost:4200)

### Tutor por IA (API [maieutica](https://github.com/luisricar-do/maieutica))

1. Siga o README do repositório **maieutica** para subir as Azure Functions localmente (por exemplo `http://localhost:7071`).
2. Na IDE, a URL da API é lida de `packages/ide/src/environments/environment.ts` (desenvolvimento) e `environment.prod.ts` (produção), propriedade **`agentApiBaseUrl`**. Deve incluir o prefixo `/api` (ex.: `http://localhost:7071/api`). Em produção, defina o valor antes do build ou via substituição de arquivo do Angular.
3. O backend deve permitir **CORS** para a origem da IDE (ver `Host.CORS` em `local.settings.json` no maieutica ou o portal Azure em produção).
4. Para compilar só o cliente HTTP do tutor: `npm run build:agent`. O `npm run build` da raiz já inclui todos os pacotes necessários para a IDE.
5. **Interface do tutor:** use **⌘⇧A** (macOS) ou **Ctrl+Shift+A** (Windows/Linux) para abrir/fechar o painel; **Esc** também fecha. O histórico mantém-se enquanto a página estiver aberta (o painel fica montado em segundo plano).

### Execução headless (banco de itens da avaliação)

O mesmo runtime que corre no navegador também corre em Node, para pré-computar os erros de
compilação de cada estado de código e rodar os casos de teste de um item sem abrir a IDE — é a
regra objetiva do movimento do estudante (progresso, estagnação, regressão).

```bash
npm run build:runner
echo '{ "code": "programa {\n funcao inicio() {\n escreva(1)\n }\n}", "stdin": [], "timeoutMs": 5000 }' \
  | node packages/runner/lib/headless/cli.js
```

A saída é JSON com `errors`, `parseErrors`, `compilerErrorLines`, `stdout`, `timedOut`,
`stdoutTruncated`, `runtimeError` e `executed`; a entrada pode ser um objeto ou uma lista de
objetos (um por estado de código). O `timeoutMs` corta laços infinitos e a saída é limitada a
64 000 caracteres. Em API: `runPortugolProgram()` de `@luisricar-do/runner`.

### Telemetria da avaliação (dissertação)

Eventos do tutor são gravados em `localStorage` **antes** de qualquer tentativa de
rede e enviados em lotes para `POST {agentApiBaseUrl}/telemetry`, que os persiste
como NDJSON no Azure Blob Storage (ver README do **maieutica**).

- **Ligar/desligar:** `enableTutorTelemetry` em `environment.ts` / `environment.prod.ts`.
  Sem `agentApiBaseUrl` configurado, nada é registado.
- **Identificação:** o navegador gera um `installId` persistente (`localStorage`) e um
  `sessionId` por aba (`sessionStorage`). Nenhum dado pessoal é registado.
- **Atribuição do participante:** abra a IDE com `?pid=P07&cond=turma-2026-1`. O `cond` é um
  rótulo livre da **etapa de coleta** (normalizado como *slug*), não um braço experimental — o
  desenho não tem grupos. Os valores persistem na sessão, sobrevivendo a recarregamentos da aba.
- **Envio:** lotes de 50 eventos a cada 10 s, mais um envio em `pagehide` e ao ocultar
  a aba. Falha de rede, `503` (armazenamento desligado) ou `5xx` mantêm os eventos na
  fila com *backoff* exponencial — nada se perde se o backend estiver fora do ar.
- **Perdas são visíveis:** `seq` monotónico por sessão permite detetar lacunas na
  análise; eventos descartados (fila cheia, `400`) são reportados como evento
  `telemetry_dropped`.
- **Contingência:** abra com `?tutorTelemetry=1` para expor no console
  `dumpTutorTelemetry()`, `flushTutorTelemetry()` e `downloadTutorTelemetry()`
  (baixa um JSON com todas as sessões deste navegador).

#### Barra de sessão e timebox

Com `?pid=` (ou `?study=1`, que mostra o formulário de atribuição) aparece uma barra no
topo da IDE para conduzir a sessão: seletor de tarefa, botão **Iniciar**, cronómetro do
*timebox* e botões **Concluí** / **Interromper**. Fora de uma sessão de pesquisa a barra
não é renderizada e a IDE fica inalterada.

Timeboxes conforme o apêndice de enunciados: **10 min** em T1–T2 e **15 min** em T3–T6 (não há
pré-teste nem tarefa de transferência). Esgotado o tempo, a tarefa é encerrada automaticamente com
`outcome: "timeout"`. O início da tarefa persiste em `sessionStorage`: recarregar a aba
**não** reinicia o cronómetro. Como o navegador estrangula temporizadores em aba oculta,
todo o tempo registado é medido pelo relógio real no instante do evento, e o timebox é
reavaliado quando a aba volta ao primeiro plano.

#### Eventos registados

| Evento | Quando | Campos próprios |
| --- | --- | --- |
| `session_start` / `app_reload` | Arranque da aplicação (o segundo quando o `sessionId` já tinha eventos) | — |
| `task_start` | Botão **Iniciar** | `taskLabel`, `timeboxMs` |
| `task_end` | **Concluí**, **Interromper** ou fim do timebox | `outcome` (`solved`/`aborted`/`timeout`), `taskElapsedMs`, `studentTurns` |
| `code_edit` | Alteração no editor (antes do debounce, para preservar a ordem face aos turnos) | `codeLength`, `codeLines` |
| `compile` | Verificação estática concluída | `errorCount`, `errorClass`, `errorClassCounts`, `errorLines`, `trigger` |
| `run` | Início e fim da execução | `phase`, `outcome` (`finished`/`runtime_error`/`compile_error`/`stopped`), `durationMs` |
| `first_help_request` | Primeiro pedido de orientação **do estudante** em cada tarefa | — |
| `chat_turn_user` | Mensagem enviada ao tutor | `origin` (`student`/`proactive`), `messageLength`, `hintLevel` |
| `chat_turn_assistant` | Resposta concluída | `latencyMs`, `replyLength`, `suggestedConversationEnd` |
| `hint_level_changed` | Ajuste do nível de dica | `fromLevel`, `toLevel` |
| `sse_error` / `api_error` | Falha no stream ou na chamada | `status`, `latencyMs` |
| `telemetry_dropped` | Perda por fila cheia ou rejeição `400` | `droppedEvents` |

Todo evento leva `seq`, `ts`, `task`, `taskElapsedMs`, `tabKey`, `hudOpen`, `dialogTurnCount`
e `userMessageCount`, além da identidade do envelope. **O código-fonte não é enviado** — só
tamanho, número de linhas e as linhas com erro.

Dois campos merecem nota metodológica:

- `origin` separa o pedido explícito do estudante do disparo proativo da IDE. Só o primeiro
  conta como pedido de orientação, e é ele que abre a janela da métrica de atrito.
- `errorClass` cobre `syntax`, `type_mismatch` e `undeclared_identifier`. **`logic` e
  `infinite_loop` não são classificados na IDE**: o primeiro compila e executa, o segundo só
  se manifesta em execução. Ambos são derivados na análise, a partir do desfecho da tarefa e
  dos eventos `run` (em particular `outcome: "stopped"` com duração longa).

## Contribuidores

- [Douglas Gadêlha](https://github.com/dgadelha)
- [Danilo Gadêlha](https://github.com/dngadelha)
- [Laboratório de Inovação Tecnológica na Educação (LITE) da Universidade do Vale do Itajaí (UNIVALI)](https://github.com/UNIVALI-LITE)

## Sobre o Projeto

**Autores:** [Douglas Gadêlha](mailto:dgadelha@live.com) e [Danilo Gadêlha](mailto:dngadelha@outlook.com)

## Licença

    Portugol Webstudio - IDE online para o Portugol
    Copyright (C) 2025  Douglas Gadêlha, Danilo Gadêlha e contribuidores

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
