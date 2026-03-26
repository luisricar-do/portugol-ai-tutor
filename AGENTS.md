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

Responde em **português** quando o utilizador pedir.
