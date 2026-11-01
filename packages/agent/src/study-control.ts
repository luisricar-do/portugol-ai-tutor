/**
 * Controle da sessão de coleta que o condutor muda pelo painel e a IDE lê por polling em
 * `GET {api}/coleta/controle` (serviço maieutica). Funções puras, para a regra ficar testável
 * fora do Angular.
 */

/**
 * O que a rota devolve. Os padrões do serviço são pré-código ligado e início travado.
 */
export interface StudyControl {
  /**
   * Se os cenários (T1–T6) abrem com o código defeituoso (`true`) ou com o esqueleto vazio.
   * O treino mostra sempre o código.
   */
  readonly preCodigo: boolean;
  /**
   * Se o condutor já liberou o primeiro cenário depois do treino, para a coleta aberta.
   */
  readonly inicioLiberado: boolean;
}

/**
 * Valida o corpo de `GET /coleta/controle`. Corpo inesperado devolve `undefined`: quem chama
 * mantém o que já sabia, em vez de liberar ou trocar o modo por engano.
 */
export function parseStudyControl(body: unknown): StudyControl | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { preCodigo, inicioLiberado } = body as Record<string, unknown>;
  if (typeof preCodigo !== "boolean" || typeof inicioLiberado !== "boolean") {
    return undefined;
  }
  return { preCodigo, inicioLiberado };
}

export interface StudyReleaseState {
  /**
   * Aba em "Só estou testando": nunca espera o condutor.
   */
  readonly testMode: boolean;
  readonly running: boolean;
  /**
   * Tarefas encerradas nesta sessão (e as retomadas de uma sessão anterior); 0 é o treino.
   */
  readonly completed: readonly number[];
  /**
   * Última resposta do serviço; `undefined` enquanto nenhuma chegou.
   */
  readonly released: boolean | undefined;
}

/**
 * Trava pós-treino: quem já terminou o treino e ainda não encerrou cenário nenhum espera o
 * «Liberar início» do condutor. Quem retoma com cenários feitos, ou com um em curso, não fica
 * preso, e o modo teste nunca trava. Sem resposta do serviço ainda, trava: liberar por engano
 * desalinharia a sala, e a resposta chega na volta seguinte do polling.
 */
export function awaitsStudyRelease(state: StudyReleaseState): boolean {
  if (state.testMode || state.running || state.released === true) {
    return false;
  }
  const practiceDone = state.completed.includes(0);
  const scenariosDone = state.completed.some(index => index !== 0);
  return practiceDone && !scenariosDone;
}
