// Gerado por scripts/importar-cenarios.mjs a partir do banco da bancada — não editar manualmente.

/**
 * Um `unit_test` do item: entradas dos `leia`, na ordem, e o que a saída deve (ou não) conter.
 */
export interface StudyTestCase {
  readonly input: readonly string[];
  readonly expectedContains: string;
  readonly expectedNotContains?: string;
}

export interface StudyTaskMaterial {
  /**
   * Id do item no banco (`maieutica-avaliacoes/avaliacao/banco`).
   */
  readonly bankItem: string;
  /**
   * Enunciado do apêndice, mostrado na barra; nunca enviado ao tutor.
   */
  readonly statement: string;
  /**
   * Código defeituoso: o `bug_code` do item, igual ao estado `s0` da bancada.
   */
  readonly code: string;
  readonly codeSha256: string;
  /**
   * Casos de teste do banco; o primeiro aparece como exemplo no enunciado.
   */
  readonly tests: readonly StudyTestCase[];
}

export const STUDY_TASK_MATERIAL: Readonly<Record<number, StudyTaskMaterial>> = {
  1: {
    bankItem: "tese_01_media",
    statement: "O programa a seguir deveria ler três números reais e escrever a média aritmética desses valores. Ele contém erros e não produz o resultado correto. Localize e corrija os defeitos para que o programa compile e calcule a média corretamente.",
    code: "programa\n{\n    funcao inicio()\n    {\n        real a, b, c\n        inteiro media\n\n        escreva(\"Digite tres numeros reais: \")\n        leia(a\n        leia(b)\n        leia(c)\n\n        media = a + b + c / 3\n        escreva(\"Media = \", media, \"\\n\")\n    }\n}\n",
    codeSha256: "f79f339225a3b34bb64c566ce68bb414edaeee396bdc5206c45ed8cc3075a8d7",
    tests: [{"input":["2","4","6"],"expectedContains":"Media = 4\n"},{"input":["10","10","10"],"expectedContains":"Media = 10\n"},{"input":["1","2","2"],"expectedContains":"Media = 1.6666666666666667\n"}],
  },
  2: {
    bankItem: "tese_02_aprovacao",
    statement: "O programa a seguir deveria ler a nota final de um estudante (real, de 0 a 10) e informar se ele está aprovado ou reprovado, considerando aprovado quem obtiver nota maior ou igual a 6,0. O programa compila, mas classifica erradamente alguns casos. Localize e corrija o defeito.",
    code: "programa\n{\n    funcao inicio()\n    {\n        real nota\n\n        escreva(\"Digite a nota final: \")\n        leia(nota)\n\n        se (nota > 6.0)\n        {\n            escreva(\"Aprovado\", \"\\n\")\n        }\n        senao\n        {\n            escreva(\"Reprovado\", \"\\n\")\n        }\n    }\n}\n",
    codeSha256: "7df800f10ef8fd2d597003fc5d712ddaac8aabe375c1f2e831a2025118cb6a8c",
    tests: [{"input":["7.5"],"expectedContains":"Aprovado\n"},{"input":["6.0"],"expectedContains":"Aprovado\n"},{"input":["4.0"],"expectedContains":"Reprovado\n"}],
  },
  3: {
    bankItem: "tese_03_tabuada",
    statement: "O programa a seguir deveria ler um inteiro N (1 ≤ N ≤ 10) e imprimir a tabuada de N, de N x 1 até N x 10, uma linha por produto, no formato “N x i = p”. Ao ser executado, o programa trava (não termina). Localize e corrija os defeitos.",
    code: "programa\n{\n    funcao inicio()\n    {\n        inteiro n, i\n\n        escreva(\"Digite um numero (1 a 10): \")\n        leia(n)\n\n        i = 0\n        enquanto (i <= 10)\n        {\n            escreva(n, \" x \", i, \" = \", n * i, \"\\n\")\n        }\n    }\n}\n",
    codeSha256: "01d59c5933ae475ae481fe792d3b221d9d8b2aeadca8d02546ee0df296e86b69",
    tests: [{"input":["3"],"expectedContains":"3 x 10 = 30\n","expectedNotContains":"3 x 0 = 0"},{"input":["2"],"expectedContains":"2 x 1 = 2\n","expectedNotContains":"2 x 0 = 0"}],
  },
  4: {
    bankItem: "tese_04_par_impar",
    statement: "O programa a seguir deveria ler cinco inteiros, um de cada vez, e informar, para cada um, se é par ou ímpar. O programa compila, mas a classificação sai errada. Localize e corrija os defeitos.",
    code: "programa\n{\n    funcao inicio()\n    {\n        inteiro numero, i, resto\n\n        para (i = 0; i < 5; i++)\n        {\n            escreva(\"Digite um numero: \")\n            leia(numero)\n\n            resto = numero / 2\n            se (resto == 0)\n            {\n                escreva(numero, \" e par\\n\")\n            }\n            senao\n            {\n                escreva(i, \" e impar\\n\")\n            }\n        }\n    }\n}\n",
    codeSha256: "240f94246b68424a54b4b8dd97bdd250da834b93d8163c78e6c8673e0023ab03",
    tests: [{"input":["4","7","10","3","0"],"expectedContains":"7 e impar\n","expectedNotContains":"1 e impar"},{"input":["-3","2","5","8","11"],"expectedContains":"-3 e impar\n","expectedNotContains":"0 e impar"},{"input":["4","6","8","10","12"],"expectedContains":"12 e par\n","expectedNotContains":" e impar"}],
  },
  5: {
    bankItem: "tese_05_maior_vetor",
    statement: "O programa a seguir deveria ler um inteiro n (3 ≤ n ≤ 10), ler n números inteiros em um vetor e imprimir o maior valor. O programa pede mais números do que os n solicitados e, em certos casos, interrompe a execução com falha de acesso ao vetor ou imprime um valor que não pertence à lista digitada. Localize e corrija os defeitos.",
    code: "programa\n{\n    funcao inicio()\n    {\n        inteiro n, i\n        inteiro numeros[10]\n        inteiro maior\n\n        escreva(\"Quantos numeros? \")\n        leia(n)\n\n        para (i = 0; i <= n; i++)\n        {\n            escreva(\"Digite um numero: \")\n            leia(numeros[i])\n        }\n\n        maior = 0\n        para (i = 0; i < n; i++)\n        {\n            se (numeros[i] > maior)\n            {\n                maior = numeros[i]\n            }\n        }\n\n        escreva(\"Maior valor: \", maior, \"\\n\")\n    }\n}\n",
    codeSha256: "78118a20c66bef920d21cc328cbba8a057da34073913d4a51eba027eeeda9928",
    tests: [{"input":["5","3","9","1","9","2"],"expectedContains":"Maior valor: 9\n"},{"input":["4","-1","-5","-2","-3"],"expectedContains":"Maior valor: -1\n"},{"input":["10","4","8","15","16","23","42","7","1","9","2"],"expectedContains":"Maior valor: 42\n"}],
  },
  6: {
    bankItem: "tese_06_contagem",
    statement: "O programa a seguir deveria ler um inteiro n (3 ≤ n ≤ 15), ler n inteiros em um vetor e imprimir quantos elementos são ímpares e maiores que 10. Ele compila e executa, mas devolve a contagem errada. Localize e corrija o defeito.",
    code: "programa\n{\n    funcao inicio()\n    {\n        inteiro n, i, contador\n        inteiro numeros[15]\n\n        escreva(\"Quantos numeros? \")\n        leia(n)\n\n        para (i = 0; i < n; i++)\n        {\n            leia(numeros[i])\n        }\n\n        contador = 0\n        para (i = 0; i < n; i++)\n        {\n            se (numeros[i] % 2 == 0 e numeros[i] > 10)\n            {\n                contador = contador + 1\n            }\n        }\n\n        escreva(\"Quantidade: \", contador, \"\\n\")\n    }\n}\n",
    codeSha256: "913617ce908ad714b0a475442d3bc8f9c8891963de837a98d364522a9748a681",
    tests: [{"input":["5","8","11","15","4","13"],"expectedContains":"Quantidade: 3\n"},{"input":["4","12","14","16","20"],"expectedContains":"Quantidade: 0\n"},{"input":["5","4","9","11","7","13"],"expectedContains":"Quantidade: 2\n"}],
  },
};
