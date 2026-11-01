import { describe, expect, test } from "vitest";

import { STARTER_SKELETON, STARTER_SKELETON_SHA256, taskMaterial } from "./study-material";
import { STUDY_TASK_MATERIAL } from "./study-tasks.gerado";

const SCENARIOS = [1, 2, 3, 4, 5, 6];

describe("material sem pré-código", () => {
  test("o hash anotado é o do esqueleto, que é o do enunciado do pedido", async () => {
    // Web Crypto (global no Node e no navegador): o tsconfig da IDE não tem os tipos do Node.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STARTER_SKELETON));
    // `Uint8Array#toHex` ainda não existe no Node da esteira nem no `lib` do tsconfig.
    // eslint-disable-next-line unicorn/prefer-uint8array-hex
    const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(STARTER_SKELETON_SHA256);
    expect(STARTER_SKELETON).toBe("programa\n{\n    funcao inicio()\n    {\n        \n    }\n}\n");
  });

  test.each(SCENARIOS)("T%i abre vazio, com enunciado de escrever e os mesmos casos", index => {
    const bank = STUDY_TASK_MATERIAL[index];
    const scratch = taskMaterial(index, false)!;
    expect(scratch.starterCode).toBe(false);
    expect(scratch.code).toBe(STARTER_SKELETON);
    expect(scratch.codeSha256).toBe(STARTER_SKELETON_SHA256);
    expect(scratch.codeSha256).not.toBe(bank.codeSha256);
    expect(scratch.bankItem).toBe(bank.bankItem);
    expect(scratch.tests).toBe(bank.tests);
    // Nada de «o programa a seguir… corrija os defeitos» diante de uma aba vazia.
    expect(scratch.statement).toMatch(/^Escreva um programa/);
    expect(scratch.statement).not.toMatch(/a seguir|defeito|Localize|corrija/i);
  });

  test.each(SCENARIOS)("T%i com pré-código continua igual ao banco", index => {
    const bank = STUDY_TASK_MATERIAL[index];
    const material = taskMaterial(index)!;
    expect(material).toEqual({ ...bank, starterCode: true });
    expect(taskMaterial(index, true)).toEqual(material);
  });

  test("o treino entrega sempre o código", () => {
    expect(taskMaterial(0, false)).toBe(taskMaterial(0));
    expect(taskMaterial(0, false)!.starterCode).toBe(true);
    expect(taskMaterial(0, false)!.code).not.toBe(STARTER_SKELETON);
  });

  test("tarefa desconhecida não tem material", () => {
    expect(taskMaterial(9, false)).toBeUndefined();
  });
});
