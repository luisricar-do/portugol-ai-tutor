import { Service, inject } from "@angular/core";
import { PortugolWebWorkersRunner } from "@luisricar-do/runner";

import { runStudyCases, studyCompileBlocked } from "./study-case";
import type { StudyTestCase } from "./study-material";
import { WorkerService } from "./worker.service";

export interface StudyCheckResult {
  passed: boolean;
  casesOk: number;
  casesTotal: number;
  /**
   * O programa nem executou (erro de compilação).
   */
  compileError: boolean;
  /**
   * Primeiro caso que falhou. A barra não o mostra ao estudante: mostra só a contagem de casos.
   */
  failedCase?: StudyTestCase;
}

/**
 * Confere o programa do estudante contra os casos de teste do cenário quando ele clica em
 * **Concluí**. Roda inteiro no navegador, com o mesmo runtime da execução normal, e não fala com
 * o tutor: os casos de teste não chegam ao serviço (invariante da bancada).
 *
 * A execução dos casos e a regra de aprovação ficam em `study-case.ts`, sem Angular nem
 * navegador, para os testes de regressão rodarem exatamente o mesmo caminho em Node.
 */
@Service()
export class StudyCheckService {
  private readonly worker = inject(WorkerService);

  async check(code: string, tests: readonly StudyTestCase[]): Promise<StudyCheckResult> {
    const transpiled = await this.worker.transpileCode(code);

    if (studyCompileBlocked(transpiled) || !transpiled.js) {
      return { passed: false, casesOk: 0, casesTotal: tests.length, compileError: true, failedCase: tests[0] };
    }

    // Em sequência: cada caso abre um worker, e o estudante espera no máximo alguns segundos.
    const { casesOk, failedCase } = await runStudyCases(transpiled.js, tests, js => new PortugolWebWorkersRunner(js));

    return { passed: casesOk === tests.length, casesOk, casesTotal: tests.length, compileError: false, failedCase };
  }
}
