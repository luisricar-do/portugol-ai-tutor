import { normalizeIntegralReals, studyCasePasses } from "@luisricar-do/agent";
import type { StudyCaseRun } from "@luisricar-do/agent";
import { PortugolDiagnosticSeverity } from "@luisricar-do/antlr";
import type { IPortugolCodeDiagnostic } from "@luisricar-do/antlr";
import type { IPortugolRunner } from "@luisricar-do/runner";

import type { StudyTestCase } from "./study-tasks.gerado";

/**
 * Teto de cada caso, o mesmo do executor headless da bancada: um laço infinito (defeito de T3)
 * não pode prender o **Concluí**.
 */
export const CASE_TIMEOUT_MS = 5000;

/**
 * Laço que escreve a cada volta produz saída sem fim; acima disto o caso já falhou e a execução
 * é cortada (conta como laço que não termina, como `timedOut`).
 */
export const MAX_STDOUT_CHARS = 64_000;

/**
 * Com erro de sintaxe ou de compilação o programa nem executa, como no botão Executar.
 */
export function studyCompileBlocked(transpiled: {
  parseErrors: readonly IPortugolCodeDiagnostic[];
  diagnostics: readonly IPortugolCodeDiagnostic[];
}): boolean {
  return (
    transpiled.parseErrors.length > 0 ||
    transpiled.diagnostics.some(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error)
  );
}

/**
 * Normaliza só o fim das linhas da saída antes de comparar com o caso de teste:
 *
 * - `\r\n` e `\r` viram `\n`;
 * - espaços e tabulações antes da quebra de linha (ou no fim da saída) saem;
 * - a saída que não termina em `\n` ganha um: o fim da saída também fecha a última linha.
 *
 * Sem isto, a tabuada de T3 com o `"\n"` no começo do `escreva` (ou sem quebra depois do último
 * produto) termina em `3 x 10 = 30` sem `\n`, e o caso `3 x 10 = 30\n` falhava com o programa
 * certo, embora o console mostrasse a mesma coisa. O resto da linha não muda: `Media = 2\n` segue
 * sem casar dentro de `Media = 2.5\n`, que é o motivo de o caso guardar a quebra de linha.
 *
 * Depois aplica `normalizeIntegralReals` (`4.0` conta como `4`).
 */
export function normalizeStudyOutput(stdout: string): string {
  let text = stdout.replaceAll(/\r\n?/g, "\n").replaceAll(/[\t ]+(?=\n|$)/g, "");
  if (text !== "" && !text.endsWith("\n")) {
    text += "\n";
  }
  return normalizeIntegralReals(text);
}

/**
 * Regra do **Concluí** para um caso: a de `studyCasePasses` (a mesma da bancada) sobre a saída
 * normalizada por `normalizeStudyOutput`.
 */
export function studyOutputPasses(testCase: StudyTestCase, run: StudyCaseRun): boolean {
  return studyCasePasses(testCase, { ...run, stdout: normalizeStudyOutput(run.stdout) });
}

/**
 * Executa uma vez, alimentando os `leia` com as entradas do caso. Sem entrada restante, manda
 * linha vazia, como o executor headless, para o programa não ficar preso esperando.
 */
export function runStudyCase(
  runner: IPortugolRunner,
  input: readonly string[],
  limits: { timeoutMs?: number; maxStdoutChars?: number } = {},
): Promise<StudyCaseRun> {
  const timeoutMs = limits.timeoutMs ?? CASE_TIMEOUT_MS;
  const maxStdoutChars = limits.maxStdoutChars ?? MAX_STDOUT_CHARS;
  const pending = [...input];
  let stdout = "";
  let timedOut = false;
  let finished = false;

  // Corta o worker assim que passa do limite: o laço infinito de T3 escreve a cada volta, e
  // esperar o teto de tempo deixaria milhões de mensagens na fila da página até ela cair.
  const output = runner.stdOut$.subscribe(chunk => {
    if (stdout.length >= maxStdoutChars) {
      return;
    }
    stdout += chunk;
    if (stdout.length >= maxStdoutChars) {
      timedOut = true;
      runner.destroy(true);
    }
  });

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      timedOut = true;
      runner.destroy(true);
    }, timeoutMs);

    runner.run().subscribe(event => {
      if (event.type === "stdIn") {
        runner.stdIn.next(pending.shift() ?? "");
        return;
      }
      // O runner pode emitir `finish` mais de uma vez (erro seguido do fim do worker).
      if (!finished && event.type === "finish") {
        finished = true;
        clearTimeout(timer);
        output.unsubscribe();
        resolve({ executed: true, timedOut, stdout });
      }
    });
  });
}

export interface StudyCasesResult {
  casesOk: number;
  /**
   * Primeiro caso que falhou.
   */
  failedCase?: StudyTestCase;
}

/**
 * Roda os casos em sequência sobre o programa já transpilado: cada caso abre um runner novo, para
 * nenhum estado passar de um caso ao seguinte.
 */
export async function runStudyCases(
  js: string,
  tests: readonly StudyTestCase[],
  createRunner: (js: string) => IPortugolRunner,
  limits?: { timeoutMs?: number; maxStdoutChars?: number },
): Promise<StudyCasesResult> {
  let casesOk = 0;
  let failedCase: StudyTestCase | undefined;
  for (const testCase of tests) {
    const run = await runStudyCase(createRunner(js), testCase.input, limits);
    if (studyOutputPasses(testCase, run)) {
      casesOk++;
    } else {
      failedCase ??= testCase;
    }
  }
  return { casesOk, failedCase };
}
