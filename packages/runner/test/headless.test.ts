import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runPortugolProgram } from "../src/headless/runProgram.js";

const MEDIA = `programa {
  funcao inicio() {
    inteiro x, y
    leia(x)
    leia(y)
    escreva((x + y) / 2)
  }
}`;

const LACO_INFINITO = `programa {
  funcao inicio() {
    inteiro i = 0
    enquanto (i < 3) {
      escreva(i)
    }
  }
}`;

const SINTAXE_INVALIDA = `programa {
  funcao inicio() {
    escreva("oi"
  }
}`;

const NAO_DECLARADA = `programa {
  funcao inicio() {
    escreva(naoDeclarada)
  }
}`;

describe("runPortugolProgram", () => {
  it("executa o programa e devolve a saída, consumindo o stdin do caso de teste", async () => {
    const result = await runPortugolProgram({ code: MEDIA, stdin: ["3", "5"] });

    assert.equal(result.executed, true);
    assert.equal(result.stdout, "4");
    assert.deepEqual(result.errors, []);
    assert.equal(result.timedOut, false);
  });

  it("corta o laço infinito no timeout e limita a saída", async () => {
    const result = await runPortugolProgram({ code: LACO_INFINITO, timeoutMs: 800 });

    assert.equal(result.timedOut, true);
    assert.equal(result.stdoutTruncated, true);
    assert.ok(result.stdout.length <= 64_000);
  });

  it("não executa quando há erro de sintaxe e reporta as linhas", async () => {
    const result = await runPortugolProgram({ code: SINTAXE_INVALIDA });

    assert.equal(result.executed, false);
    assert.ok(result.parseErrors.length > 0);
    assert.ok(result.compilerErrorLines.length > 0);
    // Forma plana: o contexto cíclico do ANTLR não pode vazar para o banco de itens.
    assert.doesNotThrow(() => JSON.stringify(result));
  });

  it("reporta variável não declarada com a linha do defeito", async () => {
    const result = await runPortugolProgram({ code: NAO_DECLARADA });

    assert.deepEqual(result.compilerErrorLines, [3]);
    assert.match(result.errors[0].message, /não declarada/i);
  });
});
