import { isDevMode } from "@angular/core";

/**
 * Só o domínio de produção é a versão estável: o beta e o ambiente local se identificam como beta.
 * No fork, a produção é o GitHub Pages do repositório.
 */
export const IS_BETA = window.location.hostname !== "luisricar-do.github.io";

/**
 * Canal enviado ao Google Analytics em todos os eventos, para separar o tráfego
 * de produção do beta e do desenvolvimento local.
 */
export const RELEASE_CHANNEL = isDevMode() ? "local" : IS_BETA ? "beta" : "stable";
