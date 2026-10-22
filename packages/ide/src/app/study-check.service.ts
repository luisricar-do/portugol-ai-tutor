import { Service, inject } from "@angular/core";
import { PortugolDiagnosticSeverity } from "@luisricar-do/antlr";
import { normalizeIntegralReals, studyCasePasses } from "@luisricar-do/agent";
import type { StudyCaseRun } from "@luisricar-do/agent";
import { PortugolWebWorkersRunner } from "@luisricar-do/runner";

import type { StudyTestCase } from "./study-material";
import { WorkerService } from "./worker.service";

/**
 * Teto de cada caso, o mesmo do executor headless da bancada: um laço infinito (defeito de T3)
 * não pode prender o **Concluí**.
 */
const CASE_TIMEOUT_MS = 5000;

/**
 * Laço que escreve a cada volta produz saída sem fim; acima disto o caso já falhou e a execução
 * é cortada (conta como laço que não termina, como `timedOut`).
 */
const MAX_STDOUT_CHARS = 64_000;

export interface StudyCheckResult {
  passed: boolean;
  casesOk: number;
  casesTotal: number;
  /**
   * O programa nem executou (erro de compilação).
   */
  compileError: boolean;
  /**
   * Primeiro caso que falhou: a barra mostra só a entrada dele, sem a saída esperada.
   */
  failedCase?: StudyTestCase;
}

/**
 * Confere o programa do estudante contra os casos de teste do cenário quando ele clica em
 * **Concluí**. Roda inteiro no navegador, com o mesmo runtime da execução normal, e não fala com
 * o tutor: os casos de teste não chegam ao serviço (invariante da bancada).
 */
@Service()
export class StudyCheckService {
  private readonly worker = inject(WorkerService);

  async check(code: string, tests: readonly StudyTestCase[]): Promise<StudyCheckResult> {
    const transpiled = await this.worker.transpileCode(code);
    const blocked =
      transpiled.parseErrors.length > 0 ||
      transpiled.diagnostics.some(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error);

    if (blocked || !transpiled.js) {
      return { passed: false, casesOk: 0, casesTotal: tests.length, compileError: true, failedCase: tests[0] };
    }

    let casesOk = 0;
    let failedCase: StudyTestCase | undefined;
    // Em sequência: cada caso abre um worker, e o estudante espera no máximo alguns segundos.
    for (const testCase of tests) {
      const run = await this.runCase(transpiled.js, testCase.input);
      // `4.0` conta como `4`: o banco foi pré-computado com o runtime que escrevia o real sem
      // parte fracionária como inteiro (ver `normalizeIntegralReals`).
      if (studyCasePasses(testCase, { ...run, stdout: normalizeIntegralReals(run.stdout) })) {
        casesOk++;
      } else {
        failedCase ??= testCase;
      }
    }

    return { passed: casesOk === tests.length, casesOk, casesTotal: tests.length, compileError: false, failedCase };
  }

  /**
   * Executa uma vez, alimentando os `leia` com as entradas do caso. Sem entrada restante, manda
   * linha vazia, como o executor headless, para o programa não ficar preso esperando.
   */
  private runCase(js: string, input: readonly string[]): Promise<StudyCaseRun> {
    const runner = new PortugolWebWorkersRunner(js);
    const pending = [...input];
    let stdout = "";
    let timedOut = false;
    let finished = false;

    // Corta o worker assim que passa do limite: o laço infinito de T3 escreve a cada volta, e
    // esperar o teto de tempo deixaria milhões de mensagens na fila da página até ela cair.
    runner.stdOut$.subscribe(chunk => {
      if (stdout.length >= MAX_STDOUT_CHARS) {
        return;
      }
      stdout += chunk;
      if (stdout.length >= MAX_STDOUT_CHARS) {
        timedOut = true;
        runner.destroy(true);
      }
    });

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        timedOut = true;
        runner.destroy(true);
      }, CASE_TIMEOUT_MS);

      runner.run().subscribe(event => {
        if (event.type === "stdIn") {
          runner.stdIn.next(pending.shift() ?? "");
          return;
        }
        // O runner pode emitir `finish` mais de uma vez (erro seguido do fim do worker).
        if (!finished && event.type === "finish") {
          finished = true;
          clearTimeout(timer);
          resolve({ executed: true, timedOut, stdout });
        }
      });
    });
  }
}
