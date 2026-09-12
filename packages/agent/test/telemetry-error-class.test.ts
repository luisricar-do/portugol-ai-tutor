import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyErrorMessage, summarizeErrorClasses } from "../src/telemetry-error-class.js";

test("classifica variável não declarada", () => {
  assert.equal(classifyErrorMessage("Variável não declarada: soma"), "undeclared_identifier");
  assert.equal(
    classifyErrorMessage("Linha 4, coluna 5: Variável não declarada: media"),
    "undeclared_identifier",
  );
});

test("classifica incompatibilidade de tipos", () => {
  assert.equal(
    classifyErrorMessage("Não é possível atribuir um valor do tipo 'real' a uma variável do tipo 'inteiro'"),
    "type_mismatch",
  );
  assert.equal(
    classifyErrorMessage("Não é possível retornar um valor do tipo 'cadeia' em uma função que retorna 'inteiro'"),
    "type_mismatch",
  );
  assert.equal(classifyErrorMessage("Não foi possível resolver o tipo da expressão"), "type_mismatch");
});

test("classifica erros estruturais e do parser como sintaxe", () => {
  assert.equal(classifyErrorMessage("O programa deve conter uma função chamada 'inicio'"), "syntax");
  assert.equal(classifyErrorMessage("A função 'inicio' não deve receber parâmetros"), "syntax");
  assert.equal(classifyErrorMessage("mismatched input '}' expecting ';'", { parseError: true }), "syntax");
  assert.equal(classifyErrorMessage("qualquer coisa do ANTLR", { parseError: true }), "syntax");
});

test("mensagem semântica mantém a classe mesmo vinda do parser", () => {
  assert.equal(
    classifyErrorMessage("Variável não declarada: x", { parseError: true }),
    "undeclared_identifier",
  );
});

test("mensagem vazia ou desconhecida não inventa classe", () => {
  assert.equal(classifyErrorMessage(""), "unknown");
  assert.equal(classifyErrorMessage("   "), "unknown");
  assert.equal(classifyErrorMessage("algo completamente novo"), "unknown");
});

test("summarize conta por classe e escolhe a dominante por precedência", () => {
  const result = summarizeErrorClasses(
    [
      "Variável não declarada: soma",
      "Não é possível atribuir um valor do tipo 'real' a uma variável do tipo 'inteiro'",
    ],
    ["mismatched input"],
  );

  assert.equal(result.errorCount, 3);
  assert.equal(result.errorClass, "syntax");
  assert.deepEqual(result.errorClassCounts, {
    syntax: 1,
    undeclared_identifier: 1,
    type_mismatch: 1,
  });
});

test("summarize sem erros devolve classe indefinida", () => {
  const result = summarizeErrorClasses([]);
  assert.equal(result.errorClass, undefined);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.errorClassCounts, {});
});

test("summarize sem sintaxe promove declaração antes de tipo", () => {
  const result = summarizeErrorClasses([
    "Não foi possível resolver o tipo da expressão",
    "Variável não declarada: n",
  ]);
  assert.equal(result.errorClass, "undeclared_identifier");
});
