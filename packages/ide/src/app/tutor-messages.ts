/** Mensagens locais da ADA (sem chamada à API). */

export const TUTOR_WELCOME_MESSAGE =
  "Olá! Estou aqui para te ajudar a depurar. Quando encontrar um erro, me conta o que você acha que está acontecendo e vamos pensar juntos.";

export const TUTOR_COMPILE_RUN_PROMPT =
  "Você tentou executar e apareceu um erro. O que você observou no código antes de executar?";

export const TUTOR_SUCCESS_REFLECTION_MESSAGE = "O programa rodou! O que você aprendeu com esse processo de depuração?";

export const TUTOR_LOGIC_SUCCESS_ENCOURAGEMENT_MESSAGE =
  "Boa, agora ele executou sem erros. Que caso de teste você quer usar para conferir se a lógica ficou como você esperava?";

/**
 * Teto de espera até o primeiro token do fluxo SSE. Depois do primeiro token o estudante vê
 * progresso na interface e a espera deixa de competir por atenção; antes dele, não vê nada.
 * O limite vale, por isso, só para essa primeira janela: começado o fluxo, a geração corre até
 * ao fim. É a fronteira operacional entre espera e indisponibilidade declarada na dissertação.
 */
export const TUTOR_FIRST_TOKEN_TIMEOUT_MS = 10_000;

export const TUTOR_FIRST_TOKEN_TIMEOUT_MESSAGE =
  "O tutor está demorando mais que o normal e pode estar temporariamente indisponível. " +
  "Continue a investigar pelo código e pelas mensagens do compilador, e tente de novo em instantes.";
