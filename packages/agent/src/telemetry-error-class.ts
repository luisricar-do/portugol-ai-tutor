/**
 * Classificação das mensagens do compilador nas classes de falha do protocolo
 * da dissertação (`syntax`, `type_mismatch`, `undeclared_identifier`).
 *
 * Limite deliberado: `logic` e `infinite_loop` **não** são classificáveis aqui.
 * Um defeito de lógica compila e executa — só se revela no confronto entre saída
 * esperada e obtida; um laço infinito só se manifesta em execução. Ambos são
 * derivados na análise, a partir do desfecho da tarefa e dos eventos `run`.
 * Classificá-los por texto de mensagem produziria rótulo inventado.
 */

export type TelemetryErrorClass = "syntax" | "type_mismatch" | "undeclared_identifier" | "unknown";

const UNDECLARED_PATTERNS = [/vari[aá]vel n[aã]o declarada/i, /n[aã]o declarad[ao]/i];

const TYPE_MISMATCH_PATTERNS = [
  /n[aã]o [eé] poss[ií]vel atribuir um valor do tipo/i,
  /n[aã]o [eé] poss[ií]vel retornar um valor do tipo/i,
  /n[aã]o foi poss[ií]vel resolver o tipo/i,
  /tipos? incompat[ií]ve/i,
];

const SYNTAX_PATTERNS = [
  /^linha \d+/i,
  /esperad[ao]/i,
  /inesperad[ao]/i,
  /token/i,
  /deve conter uma fun[cç][aã]o/i,
  /n[aã]o deve receber par[aâ]metros/i,
  /n[aã]o deve retornar valores/i,
  /deve retornar um valor/i,
  /mismatched input/i,
  /extraneous input/i,
  /missing /i,
  /no viable alternative/i,
];

/**
 * Classifica uma mensagem isolada. `parseError` marca erros vindos do parser
 * ANTLR, que são sintáticos por construção.
 */
export function classifyErrorMessage(message: string, options?: { parseError?: boolean }): TelemetryErrorClass {
  const text = (message ?? "").trim();
  if (!text) {
    return "unknown";
  }

  // A verificação semântica é mais específica que a sintática e vem primeiro:
  // mensagens de tipo/declaração podem carregar o prefixo "Linha N, coluna M:".
  if (UNDECLARED_PATTERNS.some(pattern => pattern.test(text))) {
    return "undeclared_identifier";
  }
  if (TYPE_MISMATCH_PATTERNS.some(pattern => pattern.test(text))) {
    return "type_mismatch";
  }
  if (options?.parseError) {
    return "syntax";
  }
  if (SYNTAX_PATTERNS.some(pattern => pattern.test(text))) {
    return "syntax";
  }
  return "unknown";
}

/**
 * Resume um conjunto de erros: contagem por classe e a classe dominante.
 *
 * A dominância segue a ordem em que o estudante encontra os defeitos —
 * sintaxe impede a compilação, logo precede tipos e declarações.
 */
export function summarizeErrorClasses(
  messages: readonly string[],
  parseErrorMessages: readonly string[] = [],
): { errorClass: TelemetryErrorClass | undefined; errorClassCounts: Record<string, number>; errorCount: number } {
  const counts: Record<string, number> = {};
  const add = (value: TelemetryErrorClass) => {
    counts[value] = (counts[value] ?? 0) + 1;
  };

  for (const message of parseErrorMessages) {
    add(classifyErrorMessage(message, { parseError: true }));
  }
  for (const message of messages) {
    add(classifyErrorMessage(message));
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return { errorClass: undefined, errorClassCounts: {}, errorCount: 0 };
  }

  const precedence: TelemetryErrorClass[] = ["syntax", "undeclared_identifier", "type_mismatch", "unknown"];
  const dominant = precedence.find(candidate => (counts[candidate] ?? 0) > 0);

  return { errorClass: dominant, errorClassCounts: counts, errorCount: total };
}
