# Contexto Cursor — portugol-ai-tutor

## Repositório atual

**portugol-ai-tutor** é um **fork** do [Portugol-Webstudio](https://github.com/dgadelha/Portugol-Webstudio) (UNIFEI / dissertação): IDE Angular para Portugol no browser, com integração ao **tutor socrático** via pacote `@luisricar-do/agent` e UI de chat (`packages/ide/src/app/agent-chat/`).

- **Monorepo:** npm workspaces + **Lerna** (`packages/*`)
- **IDE:** `packages/ide` — Angular ~21, Monaco, Material
- **Cliente tutor:** `packages/agent` — `/api/help` e `/api/help/stream` (SSE)
- **Outros pacotes:** antlr, parser, runner, runtime, worker, resources (ver `README.md`)
- **Comandos:** `npm ci`, `npm run build`, `npm start` → [http://localhost:4200](http://localhost:4200)
- **Upstream:** sincronizar com `upstream/main` quando fizer sentido (ver `README.md`)

## Backend companheiro

| Repositório | Função |
|-------------|--------|
| [maieutica](https://github.com/luisricar-do/maieutica) | Azure Function + LangGraph — expõe `/api/help` e `/api/help/stream` |

URLs da API configuráveis em `packages/ide/src/environments/environment*.ts`.

## Regras neste repo

Ficheiros em `.cursor/rules/*.mdc`:

- **`portugol-fork.mdc`** — contexto fork, monorepo e tutor
- **`angular-ide.mdc`** — convenções ao editar a IDE (TS/HTML)

## Skills Cursor úteis (referência)

| Skill / área | Quando usar |
|--------------|-------------|
| `create-rule` | Novas regras ou padrões `.cursor/rules` |
| `create-skill` | Skills personalizadas do projeto |
| `update-cursor-settings` | Editor / VS Code |
| `check-compiler-errors` (Team Kit) | Validar build TypeScript/Angular |
| `fix-ci`, `loop-on-ci` | CI |
| `deslop` | Limpar ruído em diffs |
| Prisma / Figma | Só se a tarefa for nesse domínio |

Skills residem em `~/.cursor/skills-cursor/` e em plugins; a IA pode carregar o `SKILL.md` correspondente quando relevante.
