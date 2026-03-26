# `@luisricar-do/ide`

Este pacote contém a IDE do Portugol Webstudio, um ambiente de desenvolvimento integrado para a linguagem Portugol desenvolvido com o framework [Angular](https://angular.io/), [Angular Material](https://material.angular.io/) e [Monaco Editor](https://microsoft.github.io/monaco-editor/).

O módulo **agent-chat** usa o pacote workspace `@luisricar-do/agent` para falar com a API do tutor socrático (Azure Functions no repositório [maieutica](https://github.com/luisricar-do/maieutica)). Configure a URL em `src/environments/environment.ts` / `environment.prod.ts` (`agentApiBaseUrl`, com sufixo `/api`).
