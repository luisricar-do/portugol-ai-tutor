/**
 * Mensagens locais da ADA (sem chamada à API).
 */

export const TUTOR_WELCOME_MESSAGE =
  "Olá! Estou aqui para te ajudar a depurar. Quando encontrar um erro, me conta o que você acha que está acontecendo e vamos pensar juntos.";

export const TUTOR_COMPILE_RUN_PROMPT =
  "Você tentou executar e apareceu um erro. O que você observou no código antes de executar?";

/**
 * Sai quando somem os erros de compilação. Compilar não é resolver: o defeito lógico pode
 * continuar lá, por isso a mensagem manda executar e conferir em vez de declarar sucesso.
 */
export const TUTOR_COMPILE_FIXED_MESSAGE =
  "Agora o código compila sem erros. Execute e confira se o programa faz o que o enunciado pede.";

export const TUTOR_RUNTIME_ERROR_PROMPT = "O programa falhou ao executar. Pode me ajudar a entender o que aconteceu?";

/**
Teto da mensagem de erro de execução citada na fala proativa.
*/
export const TUTOR_RUNTIME_ERROR_DETAIL_MAX_CHARS = 300;

/**
 * Fala proativa de erro de execução com a mensagem que o console mostrou. Sem ela a ADA não
 * sabia qual erro houve (o pedido só leva erros de compilação) e respondia sobre o histórico.
 */
export function tutorRuntimeErrorPrompt(detail?: string): string {
  const clean = (detail ?? "").replaceAll(/\s+/g, " ").trim();
  if (!clean) {
    return TUTOR_RUNTIME_ERROR_PROMPT;
  }
  const cut =
    clean.length > TUTOR_RUNTIME_ERROR_DETAIL_MAX_CHARS
      ? `${clean.slice(0, TUTOR_RUNTIME_ERROR_DETAIL_MAX_CHARS - 1)}…`
      : clean;
  return `O programa falhou ao executar com o erro: "${cut}". Pode me ajudar a entender o que aconteceu?`;
}

export const TUTOR_LOGIC_SUCCESS_ENCOURAGEMENT_MESSAGE =
  "Boa, agora ele executou sem erros. Que caso de teste você quer usar para conferir se a lógica ficou como você esperava?";

/**
 * Teto de espera até o primeiro token do fluxo SSE. Depois do primeiro token o estudante vê
 * progresso na interface e a espera deixa de competir por atenção; antes dele, não vê nada.
 * O limite vale, por isso, só para essa primeira janela: começado o fluxo, a geração corre até
 * ao fim. É a fronteira operacional entre espera e indisponibilidade declarada na dissertação.
 *
 * Eram 10 s até 21/10/2026. Na v2 o primeiro token só sai depois do analista e do estrategista,
 * e na bancada 11–18% dos turnos passaram de 10 s. Com o teto de 12 s por chamada no serviço, uma
 * chamada travada é refeita em ~15 s, e 30 s cobrem uma retentativa. O valor em vigor vai em
 * `timeoutMs` de cada `first_token_timeout`, o que separa os turnos de antes e de depois.
 */
export const TUTOR_FIRST_TOKEN_TIMEOUT_MS = 30_000;

export const TUTOR_FIRST_TOKEN_TIMEOUT_MESSAGE =
  "O tutor está demorando mais que o normal e pode estar temporariamente indisponível. " +
  "Continue a investigar pelo código e pelas mensagens do compilador, e tente de novo em instantes.";
