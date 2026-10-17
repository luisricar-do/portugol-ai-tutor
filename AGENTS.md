# Instruções para agentes (portugol-ai-tutor)

Fork do **Portugol Webstudio** com tutor socrático integrado (`@luisricar-do/agent` + UI de chat na IDE).

## Onde ler contexto detalhado

- **`.cursor/CONTEXT.md`** — monorepo, backend maieutica, índice de rules e skills.
- **`README.md`** — estrutura de pacotes, upstream, comandos npm.

## Regras automáticas

Ficheiros em **`.cursor/rules/*.mdc`** (contexto do fork + convenções para `packages/**/*.ts` e `.html`).

## Comandos rápidos

- `npm ci` — dependências
- `npm run build` — build Lerna de todos os pacotes
- `npm start` — IDE em http://localhost:4200

## Configuração e coleta

- A URL do serviço do tutor vem da variável **`AGENT_API_BASE_URL`** no build (`packages/ide/scripts/inject-version.mjs`; na esteira, a _variable_ do repositório), não de `environment*.ts`.
- Modo de coleta: formulário de matrícula, modo teste, build sem Firebase/Analytics via `npm run build:study` com `audit:study`.
- **Aviso: push em `develop` publica a IDE de produção** (`deploy.yml`, sem `paths-ignore`). Use outro branch para qualquer trabalho.

Responde em **português** quando o utilizador pedir.
