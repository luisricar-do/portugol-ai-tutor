import { PortugolCodeError } from "@luisricar-do/antlr";
import { PortugolErrorChecker } from "@luisricar-do/parser";
import { PortugolJs } from "@luisricar-do/runtime";

import { PortugolNodeRunner } from "../runners/PortugolNodeRunner.js";

export interface HeadlessRunOptions {
  /** Código-fonte Portugol do estado a executar. */
  code: string;
  /** Entradas consumidas pelos `leia`, na ordem em que o programa as pede. */
  stdin?: string[];
  /** Corta a execução (laço infinito é um dos defeitos do banco de itens). */
  timeoutMs?: number;
}

/**
 * Erro de compilação em forma serializável.
 *
 * `PortugolCodeError` carrega o contexto do ANTLR, que é cíclico e não sobrevive a
 * `JSON.stringify`; o harness precisa da forma plana para gravar no banco de itens.
 */
export interface HeadlessCodeError {
  message: string;
  startLine: number;
  startCol: number;
  endLine?: number;
  endCol?: number;
}

export interface HeadlessRunResult {
  /** Erros de compilação do verificador (mesma lista que a IDE mostra). */
  errors: HeadlessCodeError[];
  parseErrors: HeadlessCodeError[];
  /** Linhas 1-based com erro, no formato aceite por `compilerErrorLines` em `/api/help`. */
  compilerErrorLines: number[];
  /** Saída do programa, concatenada. Vazia quando não chegou a executar. */
  stdout: string;
  /** `true` quando o programa foi interrompido pelo `timeoutMs`. */
  timedOut: boolean;
  /** `true` quando a saída foi cortada em `MAX_STDOUT_CHARS` (típico de laço infinito). */
  stdoutTruncated: boolean;
  /** Mensagem de erro de execução, quando houver. */
  runtimeError?: string;
  /** `false` quando erros de compilação impediram a execução. */
  executed: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Um laço infinito que escreve a cada volta produz saída ilimitada; corta-se aqui. */
export const MAX_STDOUT_CHARS = 64_000;

function toPlainError(error: PortugolCodeError): HeadlessCodeError {
  return {
    message: error.message,
    startLine: error.startLine,
    startCol: error.startCol,
    endLine: error.endLine,
    endCol: error.endCol,
  };
}

function compilerErrorLinesFrom(errors: HeadlessCodeError[]): number[] {
  const lines = [...new Set(errors.map(error => error.startLine).filter(line => Number.isFinite(line) && line >= 1))];

  // `toSorted` não está na lib de destino deste pacote; `lines` já é uma cópia.
  // eslint-disable-next-line unicorn/no-array-sort
  return lines.sort((a, b) => a - b);
}

/**
 * Compila e executa um programa Portugol sem navegador.
 *
 * Usado pelo harness da avaliação para (a) pré-computar `errors` e `compilerErrorLines` de cada
 * estado de código do banco de itens e (b) rodar os casos de teste de um item sobre um estado,
 * que é a regra objetiva do movimento do estudante.
 */
export async function runPortugolProgram({
  code,
  stdin = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: HeadlessRunOptions): Promise<HeadlessRunResult> {
  let errors: HeadlessCodeError[] = [];
  let parseErrors: HeadlessCodeError[] = [];
  let js = "";

  try {
    const checkResult = PortugolErrorChecker.checkCode(code);

    errors = checkResult.errors.map(error => toPlainError(error));
    parseErrors = checkResult.parseErrors.map(error => toPlainError(error));
    js = new PortugolJs().visit(checkResult.tree) ?? "";
  } catch (error) {
    return {
      errors,
      parseErrors,
      compilerErrorLines: compilerErrorLinesFrom([...errors, ...parseErrors]),
      stdout: "",
      timedOut: false,
      stdoutTruncated: false,
      runtimeError: error instanceof Error ? error.message : String(error),
      executed: false,
    };
  }

  const compilerErrorLines = compilerErrorLinesFrom([...errors, ...parseErrors]);

  // Erro de parsing impede transpilação: não há programa para executar.
  if (parseErrors.length > 0 || !js) {
    return {
      errors,
      parseErrors,
      compilerErrorLines,
      stdout: "",
      timedOut: false,
      stdoutTruncated: false,
      executed: false,
    };
  }

  const runner = new PortugolNodeRunner(js);
  const pending = [...stdin];
  let stdout = "";
  let stdoutTruncated = false;
  let timedOut = false;
  let runtimeError: string | undefined;

  runner.stdOut$.subscribe(chunk => {
    if (stdout.length >= MAX_STDOUT_CHARS) {
      stdoutTruncated = true;
      return;
    }

    stdout += chunk;

    if (stdout.length > MAX_STDOUT_CHARS) {
      stdout = stdout.slice(0, MAX_STDOUT_CHARS);
      stdoutTruncated = true;
    }
  });

  return await new Promise<HeadlessRunResult>(resolve => {
    const timer = setTimeout(() => {
      timedOut = true;
      runner.destroy(true);
    }, timeoutMs);

    runner.run().subscribe({
      next: event => {
        switch (event.type) {
          case "stdIn": {
            // Sem entrada restante, alimenta linha vazia para o programa não ficar preso.
            runner.stdIn.next(pending.shift() ?? "");
            break;
          }

          case "error": {
            runtimeError = event.error.message;
            break;
          }

          case "finish": {
            clearTimeout(timer);
            resolve({
              errors,
              parseErrors,
              compilerErrorLines,
              stdout,
              timedOut,
              stdoutTruncated,
              runtimeError,
              executed: true,
            });
            break;
          }

          default: {
            break;
          }
        }
      },
    });
  });
}
