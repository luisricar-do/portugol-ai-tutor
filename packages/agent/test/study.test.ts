import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import {
  STUDY_PSEUDONYM_SALT,
  maskMatricula,
  normalizeMatricula,
  pseudonymFromMatricula,
  studyCasePasses,
  studyTaskOrder,
} from "../src/study.js";

test("normaliza pontuação, espaços e caixa", () => {
  assert.equal(normalizeMatricula(" 2024.0012-34 "), "2024001234");
  assert.equal(normalizeMatricula("ab12cd"), "AB12CD");
  assert.equal(normalizeMatricula("12"), undefined);
  assert.equal(normalizeMatricula("1".repeat(21)), undefined);
  assert.equal(normalizeMatricula("---"), undefined);
});

test("pseudônimo é SHA-256 do sal com a matrícula canônica", async () => {
  // Valor prendido: se mudar, os pseudônimos já coletados deixam de bater com a planilha.
  const expected = `m-${createHash("sha256").update(`${STUDY_PSEUDONYM_SALT}:2024001234`).digest("hex").slice(0, 12)}`;
  assert.equal(await pseudonymFromMatricula("2024001234"), expected);
  assert.equal(await pseudonymFromMatricula("2024.0012-34"), expected);
  assert.match(expected, /^m-[\da-f]{12}$/);
  assert.equal(STUDY_PSEUDONYM_SALT, "maieutica:uso-real:v1");
});

test("matrícula inválida não gera pseudônimo", async () => {
  assert.equal(await pseudonymFromMatricula("x"), undefined);
});

test("máscara mostra só os quatro últimos", () => {
  assert.equal(maskMatricula("2024001234"), "…1234");
  assert.equal(maskMatricula("1"), undefined);
});

test("ordem sorteada é permutação estável por participante", () => {
  const tasks = [1, 2, 3, 4, 5, 6];
  const first = studyTaskOrder("m-0123456789ab", tasks);
  assert.deepEqual(studyTaskOrder("m-0123456789ab", tasks), first);
  assert.deepEqual([...first].sort(), tasks);
  assert.deepEqual(tasks, [1, 2, 3, 4, 5, 6]);

  const distinct = new Set(Array.from({ length: 40 }, (_, i) => studyTaskOrder(`m-${i}`, tasks).join(",")));
  assert.ok(distinct.size > 30, `só ${distinct.size} ordens distintas em 40 participantes`);
});

test("caso passa só com execução terminada e saída esperada", () => {
  const caso = { expectedContains: "Media = 2\n" };
  assert.equal(studyCasePasses(caso, { executed: true, timedOut: false, stdout: "Digite: Media = 2\n" }), true);
  // A quebra de linha final é preservada: "Media = 2" não casa dentro de "Media = 2.5".
  assert.equal(studyCasePasses(caso, { executed: true, timedOut: false, stdout: "Media = 2.5\n" }), false);
  assert.equal(studyCasePasses(caso, { executed: false, timedOut: false, stdout: "Media = 2\n" }), false);
  assert.equal(studyCasePasses(caso, { executed: true, timedOut: true, stdout: "Media = 2\n" }), false);
});

test("caso com saída proibida e esperado com espaços nas pontas", () => {
  const caso = { expectedContains: " 3 x 10 = 30\n", expectedNotContains: "3 x 0 = 0" };
  assert.equal(studyCasePasses(caso, { executed: true, timedOut: false, stdout: "3 x 1 = 3\n3 x 10 = 30\n" }), true);
  assert.equal(studyCasePasses(caso, { executed: true, timedOut: false, stdout: "3 x 0 = 0\n3 x 10 = 30\n" }), false);
});
