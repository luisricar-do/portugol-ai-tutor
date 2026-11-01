import assert from "node:assert/strict";
import { test } from "vitest";

import { awaitsStudyRelease, parseStudyControl } from "../src/study-control.js";

test("controle válido passa; corpo estranho não muda nada", () => {
  assert.deepEqual(parseStudyControl({ preCodigo: false, inicioLiberado: true }), {
    preCodigo: false,
    inicioLiberado: true,
  });
  assert.equal(parseStudyControl(null), undefined);
  assert.equal(parseStudyControl({ error: "Armazenamento de telemetria não configurado." }), undefined);
  assert.equal(parseStudyControl({ preCodigo: "true", inicioLiberado: true }), undefined);
  assert.equal(parseStudyControl({ preCodigo: true }), undefined);
});

const base = { testMode: false, running: false, completed: [0], released: false } as const;

test("depois do treino espera o condutor; liberado, segue", () => {
  assert.equal(awaitsStudyRelease(base), true);
  // Sem resposta do serviço ainda: trava, a próxima volta do polling resolve.
  assert.equal(awaitsStudyRelease({ ...base, released: undefined }), true);
  assert.equal(awaitsStudyRelease({ ...base, released: true }), false);
});

test("treino por fazer ou em curso não trava", () => {
  assert.equal(awaitsStudyRelease({ ...base, completed: [] }), false);
  assert.equal(awaitsStudyRelease({ ...base, completed: [], running: true }), false);
});

test("retomada com cenário feito ou em curso não fica presa", () => {
  assert.equal(awaitsStudyRelease({ ...base, completed: [0, 4] }), false);
  // Cenário feito sem o treino na lista (progresso antigo): também não trava.
  assert.equal(awaitsStudyRelease({ ...base, completed: [2] }), false);
  assert.equal(awaitsStudyRelease({ ...base, running: true }), false);
});

test("modo teste nunca trava", () => {
  assert.equal(awaitsStudyRelease({ ...base, testMode: true, released: undefined }), false);
});
