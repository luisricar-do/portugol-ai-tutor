import { PortugolDiagnosticSeverity } from "@luisricar-do/antlr";
import { Subject, Subscription } from "rxjs";

import { IPortugolRunner, PortugolEvent, PortugolMessage } from "./runners/IPortugolRunner.js";
import type { PortugolTranspiledCode } from "./transpile.js";

/**
 * Teto da saída de uma execução. Um laço infinito com `escreva` manda milhares de pedaços por
 * segundo, e sem teto a string e o editor da saída crescem até a aba do navegador travar — o
 * enunciado da tabuada da coleta pede justamente que o aluno execute um programa assim. 2000
 * linhas cobrem com folga os programas de aula (a tabuada inteira tem 10) e ainda deixam ver o
 * padrão que se repete; os caracteres pegam a linha que nunca quebra (`escreva(i)` sem `\n`).
 */
export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_CHARS = 100_000;

/**
Conta a saída de uma execução contra o teto: `consume` devolve `false` quando ele estoura.
*/
export class OutputBudget {
  lines = 0;
  chars = 0;

  constructor(
    readonly maxLines = MAX_OUTPUT_LINES,
    readonly maxChars = MAX_OUTPUT_CHARS,
  ) {}

  consume(chunk: string): boolean {
    this.chars += chunk.length;

    for (let i = chunk.indexOf("\n"); i !== -1; i = chunk.indexOf("\n", i + 1)) {
      this.lines++;
    }

    return this.lines <= this.maxLines && this.chars <= this.maxChars;
  }

  /**
  Aviso no console: diz que é o programa que não termina, sem apontar a causa.
  */
  message(): string {
    const excess =
      this.lines > this.maxLines ? `mais de ${this.maxLines} linhas` : `mais de ${this.maxChars} caracteres`;

    return `[Execução interrompida: o programa já escreveu ${excess} e parece não terminar.]`;
  }
}

export class PortugolExecutor {
  private _runner?: IPortugolRunner;

  constructor(private runner: typeof IPortugolRunner) {
    this.stdIn.subscribe(data => {
      if (data === "\b") {
        if (this.stdInBuffer.length > 0) {
          this.stdInBuffer = this.stdInBuffer.slice(0, -1);
          this.stdOut = this.stdOut.slice(0, -1);
        }
      } else if (data === "\r") {
        this._runner?.stdIn.next(this.stdInBuffer);
        this.stdInBuffer = "";
        this.stdOut += "\n";
      } else {
        this.stdInBuffer += data;
        this.stdOut += data;
      }

      this.stdOut$.next(this.stdOut);
    });
  }

  byteCode = "";

  stdInBuffer = "";
  stdIn = new Subject<string>();

  stdOut = "";
  stdOut$ = new Subject<string>();

  /**
   * Com `false`, a saída de uma execução fica abaixo da anterior, separada por
   * uma linha em branco, em vez de começar do zero.
   */
  clearStdOutOnRun = true;
  private _stdOut$?: Subscription;

  /**
   * Com `false`, o aviso de fim da execução não diz quanto tempo ela levou.
   */
  showExecutionTime = true;

  waitingForInput = false;
  waitingForInput$ = new Subject<boolean>();
  private _waitingForInput$?: Subscription;

  running = false;
  running$ = new Subject<boolean>();
  private _running$?: Subscription;

  events = new Subject<PortugolEvent>();
  #outputBudget = new OutputBudget();
  #outputCut = false;
  #printTimes(_times: { check: number; transpile: number; execution?: number }) {}

  runTranspiled({ js, diagnostics, parseErrors, times }: PortugolTranspiledCode) {
    try {
      this.reset(this.clearStdOutOnRun);

      if (this.stdOut.length > 0) {
        this.stdOut += this.stdOut.endsWith("\n") ? "\n" : "\n\n";
      }

      /**
       * Como o Portugol Studio: código com erro de compilação não executa. Os erros vão para
       * a saída porque nem todo cliente do runner tem um editor que os mostre. Erro de
       * sintaxe vem primeiro: se o arquivo nem analisou, o resto é consequência.
       */
      const errors = [
        ...parseErrors,
        ...diagnostics.filter(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error),
      ];

      if (errors.length > 0) {
        const plural = errors.length > 1 ? "s" : "";

        this.stdOut += `⛔ O seu código possui ${errors.length} erro${plural} de compilação e não foi executado:\n\n`;

        // A coluna do diagnóstico começa em 0; a mostrada começa em 1, como no editor.
        this.stdOut += errors
          .map(error => `ERRO: ${error.message} (linha ${error.startLine}, coluna ${error.startCol + 1})\n`)
          .join("");

        this.stdOut$.next(this.stdOut);
        this.#printTimes(times);
        this.reset(false);
        // Todos os erros que barraram a execução, não só os sintáticos: quem ouve precisa
        // saber por que o programa não rodou.
        this.events.next({ type: "parseError", errors });

        return;
      }

      // @ts-expect-error
      this._runner = new this.runner(js);

      if (!this._runner) {
        throw new Error("Runner not found");
      }

      this.byteCode = this._runner.byteCode;
      this.#outputBudget = new OutputBudget();
      this.#outputCut = false;

      this._runner.stdOut$.subscribe(data => {
        // O worker pode ter enfileirado mais saída antes de ser encerrado: depois do teto, nada entra.
        if (this.#outputCut) {
          return;
        }

        if (!this.#outputBudget.consume(data)) {
          this.#cutOutput();
          return;
        }

        this.stdOut += data;
        this.stdOut$.next(data);
      });

      this._runner.waitingForInput$.subscribe(data => {
        this.waitingForInput = data;
        this.waitingForInput$.next(data);
      });

      this._runner.running$.subscribe(data => {
        this.running = data;
        this.running$.next(data);
      });

      this._runner.run().subscribe({
        next: event => {
          switch (event.type) {
            case "finish": {
              const message = event.stopped ? "O programa foi interrompido!" : "Programa finalizado.";
              const time = this.showExecutionTime ? ` Tempo de execução: ${event.time} milissegundos` : "";

              this.stdOut += `\n${message}${time}\n`;

              this.#printTimes({ ...times, execution: event.time });
              this.stdOut$.next(this.stdOut);
              break;
            }

            case "clear": {
              this.stdOut = "";
              this.stdOut$.next(this.stdOut);
              break;
            }

            case "error": {
              this.stdOut += `\n⛔ ${event.error.message}\n`;
              this.stdOut$.next(this.stdOut);
              break;
            }

            default: {
              break;
            }
          }

          // Quem ouve (a telemetria da IDE) distingue o teto do botão Parar.
          this.events.next(event.type === "finish" && this.#outputCut ? { ...event, outputLimit: true } : event);
        },

        error(error) {
          console.error(error);
        },
      });
    } catch (error) {
      console.error(error);

      this.stdOut += `\n⛔ O seu código possui um erro de compilação!\n`;
      this.stdOut$.next(this.stdOut);
      this.#printTimes(times);

      this.reset(false);
      this.events.next({ type: "parseError", errors: parseErrors });
    }
  }

  stop() {
    this.reset(false);
  }

  /**
  Para o programa pelo mesmo caminho do botão Parar, com o aviso do teto antes do de fim.
  */
  #cutOutput() {
    this.#outputCut = true;
    this.stdOut += `${this.stdOut.endsWith("\n") ? "" : "\n"}\n${this.#outputBudget.message()}\n`;
    this.stdOut$.next(this.stdOut);
    this.stop();
  }

  private reset(clearStdOut = true) {
    if (clearStdOut) {
      this.stdOut = "";
    }

    this._stdOut$?.unsubscribe();

    this.waitingForInput = false;
    this._waitingForInput$?.unsubscribe();

    this.running = false;
    this._running$?.unsubscribe();

    this._runner?.destroy(true);
  }

  postMessage(message: PortugolMessage) {
    this._runner?.postMessage(message);
  }

  replyMessage(message: PortugolMessage, result: unknown, transferable?: Transferable[]) {
    this._runner?.replyMessage(message, result, transferable);
  }
}
