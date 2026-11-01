import type { IPortugolCodeDiagnostic } from "@luisricar-do/antlr";
import { PortugolCodeChecker } from "@luisricar-do/parser";
import { PortugolWorkerThreadsRunner } from "@luisricar-do/runner";
import { PortugolJs } from "@luisricar-do/runtime";
import { describe, expect, test } from "vitest";

import { normalizeStudyOutput, runStudyCases, studyCompileBlocked, studyOutputPasses } from "./study-case";
import { taskMaterial } from "./study-material";

/**
 * O mesmo que `transpileCode` de `packages/worker/src/index.js`, que a IDE chama antes do **Concluí**.
 */
function transpile(code: string): {
  js: string;
  parseErrors: IPortugolCodeDiagnostic[];
  diagnostics: IPortugolCodeDiagnostic[];
} {
  const checked = PortugolCodeChecker.checkCode(code);
  return {
    js: new PortugolJs().visit(checked.tree) ?? "",
    parseErrors: checked.parseErrors,
    diagnostics: checked.diagnostics,
  };
}

/**
 * Caminho do **Concluí** (`StudyCheckService.check`), com o runner de `worker_threads` no lugar do
 * de Web Workers: os dois executam o mesmo código gerado com o mesmo runtime.
 */
async function concluir(index: number, code: string) {
  const material = taskMaterial(index);
  if (material === undefined) {
    throw new Error(`Sem material para a tarefa ${index}`);
  }
  const transpiled = transpile(code);
  if (studyCompileBlocked(transpiled) || !transpiled.js) {
    return { compileError: true, casesOk: 0, casesTotal: material.tests.length };
  }
  const { casesOk } = await runStudyCases(transpiled.js, material.tests, js => new PortugolWorkerThreadsRunner(js), {
    timeoutMs: 5000,
  });
  return { compileError: false, casesOk, casesTotal: material.tests.length };
}

function programa(declaracoes: string, corpo: string): string {
  return `programa\n{\n    funcao inicio()\n    {\n        ${declaracoes}\n\n${corpo}\n    }\n}\n`;
}

const TABUADA_LINHA = String.raw`escreva(n, " x ", i, " = ", n * i, "\n")`;

function tabuada(laco: string, declaracoes = "inteiro n, i"): string {
  return programa(declaracoes, `        escreva("Digite um numero (1 a 10): ")\n        leia(n)\n\n${laco}`);
}

/**
 * Soluções que um estudante entrega para cada cenário. Todas resolvem o enunciado e devem passar.
 */
const SOLUCOES: Record<number, Record<string, string>> = {
  0: {
    "subtração corrigida": programa(
      "inteiro preco, pago, troco",
      String.raw`        escreva("Preco do produto: ")
        leia(preco)
        escreva("Valor pago: ")
        leia(pago)
        troco = pago - preco
        escreva("Troco: ", troco, "\n")`,
    ),
    "sem variável troco": programa(
      "inteiro preco, pago",
      String.raw`        leia(preco)
        leia(pago)
        escreva("Troco: ", pago - preco, "\n")`,
    ),
  },
  1: {
    "media real com parênteses": programa(
      "real a, b, c\n        real media",
      String.raw`        escreva("Digite tres numeros reais: ")
        leia(a)
        leia(b)
        leia(c)
        media = (a + b + c) / 3
        escreva("Media = ", media, "\n")`,
    ),
    "divisão por 3.0 direto no escreva": programa(
      "real a, b, c",
      String.raw`        leia(a, b, c)
        escreva("Media = ", (a + b + c) / 3.0, "\n")`,
    ),
  },
  2: {
    "maior ou igual": programa(
      "real nota",
      String.raw`        escreva("Digite a nota final: ")
        leia(nota)
        se (nota >= 6.0)
        {
            escreva("Aprovado", "\n")
        }
        senao
        {
            escreva("Reprovado", "\n")
        }`,
    ),
    "condição invertida": programa(
      "real nota",
      String.raw`        leia(nota)
        se (nota < 6)
        {
            escreva("Reprovado\n")
        }
        senao
        {
            escreva("Aprovado\n")
        }`,
    ),
  },
  3: {
    "enquanto com i = i + 1": tabuada(
      `        i = 1\n        enquanto (i <= 10)\n        {\n            ${TABUADA_LINHA}\n            i = i + 1\n        }`,
    ),
    "enquanto com i++": tabuada(
      `        i = 1\n        enquanto (i <= 10)\n        {\n            ${TABUADA_LINHA}\n            i++\n        }`,
    ),
    "enquanto com i += 1": tabuada(
      `        i = 1\n        enquanto (i <= 10)\n        {\n            ${TABUADA_LINHA}\n            i += 1\n        }`,
    ),
    "incremento antes do escreva": tabuada(
      `        i = 0\n        enquanto (i < 10)\n        {\n            i = i + 1\n            ${TABUADA_LINHA}\n        }`,
    ),
    "para de 1 a 10": tabuada(`        para (i = 1; i <= 10; i++)\n        {\n            ${TABUADA_LINHA}\n        }`),
    "para com variável declarada no laço": tabuada(
      String.raw`        para (inteiro j = 1; j <= 10; j++)
        {
            escreva(n, " x ", j, " = ", n * j, "\n")
        }`,
      "inteiro n",
    ),
    "faca enquanto": tabuada(
      `        i = 1\n        faca\n        {\n            ${TABUADA_LINHA}\n            i = i + 1\n        } enquanto (i <= 10)`,
    ),
    "i inicializado na declaração": tabuada(
      `        enquanto (i <= 10)\n        {\n            ${TABUADA_LINHA}\n            i = i + 1\n        }`,
      "inteiro n, i = 1",
    ),
    "quebra de linha num escreva separado": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva(n, " x ", i, " = ", n * i)
            escreva("\n")
        }`,
    ),
    "produto numa variável": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            p = n * i
            escreva(n, " x ", i, " = ", p, "\n")
        }`,
      "inteiro n, i, p",
    ),
    "concatenação com +": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva(n + " x " + i + " = " + (n * i) + "\n")
        }`,
    ),
    // As quatro seguintes falhavam antes da normalização do fim de linha (ver normalizeStudyOutput).
    "quebra de linha antes de cada produto": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva("\n", n, " x ", i, " = ", n * i)
        }`,
    ),
    "sem quebra depois do último produto": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva(n, " x ", i, " = ", n * i)
            se (i < 10)
            {
                escreva("\n")
            }
        }`,
    ),
    "espaço antes da quebra de linha": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva(n, " x ", i, " = ", n * i, " \n")
        }`,
    ),
    "quebra de linha \\r\\n": tabuada(
      String.raw`        para (i = 1; i <= 10; i++)
        {
            escreva(n, " x ", i, " = ", n * i, "\r\n")
        }`,
    ),
  },
  4: {
    "resto com %": programa(
      "inteiro numero, i, resto",
      String.raw`        para (i = 0; i < 5; i++)
        {
            escreva("Digite um numero: ")
            leia(numero)
            resto = numero % 2
            se (resto == 0)
            {
                escreva(numero, " e par\n")
            }
            senao
            {
                escreva(numero, " e impar\n")
            }
        }`,
    ),
    "diferente de zero": programa(
      "inteiro numero, i",
      String.raw`        para (i = 1; i <= 5; i++)
        {
            leia(numero)
            se (numero % 2 != 0)
            {
                escreva(numero, " e impar\n")
            }
            senao
            {
                escreva(numero, " e par\n")
            }
        }`,
    ),
  },
  5: {
    "maior começa no primeiro": programa(
      "inteiro n, i\n        inteiro numeros[10]\n        inteiro maior",
      String.raw`        escreva("Quantos numeros? ")
        leia(n)
        para (i = 0; i < n; i++)
        {
            escreva("Digite um numero: ")
            leia(numeros[i])
        }
        maior = numeros[0]
        para (i = 1; i < n; i++)
        {
            se (numeros[i] > maior)
            {
                maior = numeros[i]
            }
        }
        escreva("Maior valor: ", maior, "\n")`,
    ),
    "maior atualizado na leitura": programa(
      "inteiro n, i\n        inteiro numeros[10]\n        inteiro maior",
      String.raw`        leia(n)
        leia(numeros[0])
        maior = numeros[0]
        para (i = 1; i < n; i++)
        {
            leia(numeros[i])
            se (numeros[i] > maior)
            {
                maior = numeros[i]
            }
        }
        escreva("Maior valor: ", maior, "\n")`,
    ),
  },
  6: {
    "resto diferente de zero": programa(
      "inteiro n, i, contador\n        inteiro numeros[15]",
      String.raw`        escreva("Quantos numeros? ")
        leia(n)
        para (i = 0; i < n; i++)
        {
            leia(numeros[i])
        }
        contador = 0
        para (i = 0; i < n; i++)
        {
            se (numeros[i] % 2 != 0 e numeros[i] > 10)
            {
                contador = contador + 1
            }
        }
        escreva("Quantidade: ", contador, "\n")`,
    ),
    "resto igual a um e contador++": programa(
      "inteiro n, i, contador = 0\n        inteiro numeros[15]",
      String.raw`        leia(n)
        para (i = 0; i < n; i++)
        {
            leia(numeros[i])
            se (numeros[i] > 10 e numeros[i] % 2 == 1)
            {
                contador++
            }
        }
        escreva("Quantidade: ", contador, "\n")`,
    ),
  },
};

/**
 * Estados intermediários que ainda têm defeito e não podem passar.
 */
const AINDA_COM_DEFEITO: Record<number, Record<string, string>> = {
  3: {
    // Estado s1 do banco: termina, mas começa em `N x 0 = 0`.
    "incremento sem corrigir o início": tabuada(
      `        i = 0\n        enquanto (i <= 10)\n        {\n            ${TABUADA_LINHA}\n            i = i + 1\n        }`,
    ),
    "para até 9": tabuada(`        para (i = 1; i < 10; i++)\n        {\n            ${TABUADA_LINHA}\n        }`),
  },
  1: {
    "média ainda inteira": programa(
      "real a, b, c\n        inteiro media",
      String.raw`        leia(a)
        leia(b)
        leia(c)
        media = (a + b + c) / 3
        escreva("Media = ", media, "\n")`,
    ),
  },
};

describe("Concluí: soluções corretas passam em todos os casos", () => {
  for (const [index, solucoes] of Object.entries(SOLUCOES)) {
    for (const [nome, code] of Object.entries(solucoes)) {
      test(`${index === "0" ? "treino" : `T${index}`}: ${nome}`, async () => {
        const result = await concluir(Number(index), code);
        expect(result.compileError).toBe(false);
        expect(result.casesOk).toBe(result.casesTotal);
      });
    }
  }
});

describe("Concluí: programa defeituoso não passa", () => {
  for (const index of [0, 1, 2, 3, 4, 5, 6]) {
    test(`${index === 0 ? "treino" : `T${index}`}: código inicial`, async () => {
      const result = await concluir(index, taskMaterial(index)!.code);
      expect(result.compileError || result.casesOk < result.casesTotal).toBe(true);
    });
  }

  for (const [index, estados] of Object.entries(AINDA_COM_DEFEITO)) {
    for (const [nome, code] of Object.entries(estados)) {
      test(`T${index}: ${nome}`, async () => {
        const result = await concluir(Number(index), code);
        expect(result.compileError).toBe(false);
        expect(result.casesOk).toBeLessThan(result.casesTotal);
      });
    }
  }
});

describe("normalizeStudyOutput", () => {
  test("fecha a última linha e tira espaços e \\r do fim das linhas", () => {
    expect(normalizeStudyOutput("3 x 9 = 27\n3 x 10 = 30")).toBe("3 x 9 = 27\n3 x 10 = 30\n");
    expect(normalizeStudyOutput("a \t\r\nb\rc  ")).toBe("a\nb\nc\n");
    expect(normalizeStudyOutput("")).toBe("");
  });

  test("mantém o resto da linha e escreve 4.0 como 4", () => {
    expect(normalizeStudyOutput("Media = 4.0")).toBe("Media = 4\n");
    expect(normalizeStudyOutput("3  x  1 = 3\n")).toBe("3  x  1 = 3\n");
  });

  test("a quebra de linha do caso continua impedindo prefixo numérico", () => {
    const caso = { input: [], expectedContains: "Media = 2\n" };
    expect(studyOutputPasses(caso, { executed: true, timedOut: false, stdout: "Media = 2.5" })).toBe(false);
    expect(studyOutputPasses(caso, { executed: true, timedOut: false, stdout: "Media = 2" })).toBe(true);
  });

  test("saída proibida continua reprovando", () => {
    const caso = { input: ["3"], expectedContains: "3 x 10 = 30\n", expectedNotContains: "3 x 0 = 0" };
    expect(studyOutputPasses(caso, { executed: true, timedOut: false, stdout: "3 x 0 = 0 \r\n3 x 10 = 30" })).toBe(
      false,
    );
  });
});
