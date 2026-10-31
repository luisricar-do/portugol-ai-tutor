import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { MAX_OUTPUT_LINES, OutputBudget, PortugolExecutor, PortugolWorkerThreadsRunner, transpile } from "../src";
import type { PortugolEvent } from "../src";

const LACO_INFINITO = `programa {
  funcao inicio() {
    inteiro i = 1
    enquanto (i <= 10) {
      escreva(i, "\\n")
    }
  }
}`;

const SEM_QUEBRA = `programa {
  funcao inicio() {
    enquanto (verdadeiro) {
      escreva("x")
    }
  }
}`;

const TABUADA = `programa {
  funcao inicio() {
    para (inteiro i = 1; i <= 10; i++) {
      escreva("7 x ", i, " = ", 7 * i, "\\n")
    }
  }
}`;

/**
Executa pelo `PortugolExecutor`, como a IDE, e devolve a saída e o evento de fim.
*/
function execute(code: string) {
  const executor = new PortugolExecutor(PortugolWorkerThreadsRunner);

  return new Promise<{ stdOut: string; finish: Extract<PortugolEvent, { type: "finish" }> }>(resolve => {
    executor.events.subscribe(event => {
      if (event.type === "finish") {
        resolve({ stdOut: executor.stdOut, finish: event });
      }
    });
    executor.runTranspiled(transpile(code));
  });
}

describe("teto da saída do PortugolExecutor", () => {
  it("interrompe um laço infinito com escreva e avisa no console", async () => {
    const { stdOut, finish } = await execute(LACO_INFINITO);

    assert.equal(finish.stopped, true);
    assert.equal(finish.outputLimit, true);
    assert.match(
      stdOut,
      /\[Execução interrompida: o programa já escreveu mais de 2000 linhas e parece não terminar\.\]/,
    );
    assert.match(stdOut, /O programa foi interrompido!/);
    // O que passou do teto não entra na saída.
    assert.ok(stdOut.split("\n").filter(line => line === "1").length <= MAX_OUTPUT_LINES);
  });

  it("também para a linha que nunca quebra, pelo teto de caracteres", async () => {
    const { stdOut, finish } = await execute(SEM_QUEBRA);

    assert.equal(finish.outputLimit, true);
    assert.match(stdOut, /mais de 100000 caracteres/);
  });

  it("não mexe num programa que termina", async () => {
    const { stdOut, finish } = await execute(TABUADA);

    assert.equal(finish.stopped, false);
    assert.equal(finish.outputLimit, undefined);
    assert.match(stdOut, /7 x 10 = 70\n/);
    assert.doesNotMatch(stdOut, /Execução interrompida/);
    assert.match(stdOut, /Programa finalizado\./);
  });
});

describe("OutputBudget", () => {
  it("conta linhas e caracteres por pedaço e estoura só depois do teto", () => {
    const budget = new OutputBudget(3, 100);

    assert.equal(budget.consume("a\nb\n"), true);
    assert.equal(budget.consume("c\n"), true);
    assert.equal(budget.consume("d\n"), false);
    assert.equal(
      budget.message(),
      "[Execução interrompida: o programa já escreveu mais de 3 linhas e parece não terminar.]",
    );

    const chars = new OutputBudget(3, 5);

    assert.equal(chars.consume("abcde"), true);
    assert.equal(chars.consume("f"), false);
    assert.match(chars.message(), /mais de 5 caracteres/);
  });
});
