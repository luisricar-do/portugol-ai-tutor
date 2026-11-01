import { STUDY_TASK_MATERIAL } from "./study-tasks.gerado";
import type { StudyTestCase } from "./study-tasks.gerado";

export type { StudyTestCase } from "./study-tasks.gerado";

export interface TaskMaterial {
  /**
   * Mostrado na barra enquanto a tarefa corre e enviado ao tutor como `problemStatement`, como
   * faz a bancada (decisão após o teste real de 31/10: sem ele o tutor inferia a tarefa do código).
   */
  readonly statement: string;
  /**
   * Programa que a aba abre.
   */
  readonly code: string;
  /**
   * `true` quando `code` é o programa defeituoso (o `bug_code` do item, ou o do treino);
   * `false` quando é o esqueleto vazio de `STARTER_SKELETON`, para escrever do zero.
   */
  readonly starterCode: boolean;
  /**
   * Só nos cenários: o item do banco e o hash do código **aberto**, que seguem no `task_start`.
   * Sem pré-código, o hash é o do esqueleto, não o do `bug_code`: a trajetória não começa no `s0`
   * da bancada e não pode ser ligada a ele por engano.
   */
  readonly bankItem?: string;
  readonly codeSha256?: string;
  /**
   * Casos que o **Concluí** confere antes de encerrar a tarefa; o primeiro é o exemplo do
   * enunciado. Ficam no navegador, como o enunciado.
   */
  readonly tests: readonly StudyTestCase[];
}

/**
 * Treino da ambientação. Fica fora do banco, como pede o roteiro, e os dois defeitos não
 * coincidem com os dos seis cenários: um nome de variável digitado errado (erro de compilação)
 * e uma soma no lugar da subtração. Assim o treino mostra o erro do compilador, a execução e a
 * conversa com a Ada sem ensinar a correção de nenhum cenário da coleta. Não pede dado pessoal:
 * os valores lidos são de uma compra fictícia.
 */
const PRACTICE_MATERIAL: TaskMaterial = {
  statement:
    "Exercício de treino (não conta para a pesquisa). O programa a seguir deveria ler o preço de um produto e o valor pago e escrever o troco. Ele não compila e, depois de corrigido isso, mostra um troco errado. Experimente executar, ler o erro e conversar com a Ada. Localize e corrija os defeitos.",
  starterCode: true,
  code: `programa
{
    funcao inicio()
    {
        inteiro preco, pago, troco

        escreva("Preco do produto: ")
        leia(preco)
        escreva("Valor pago: ")
        leia(pago)

        troco = pago + preco
        escreva("Troco: ", trco, "\\n")
    }
}
`,
  tests: [
    { input: ["10", "25"], expectedContains: "Troco: 15\n" },
    { input: ["7", "10"], expectedContains: "Troco: 3\n" },
  ],
};

/**
 * O que a aba abre quando o condutor desliga o pré-código: o programa vazio, como o Portugol
 * Studio cria um arquivo novo. O cursor cai na linha em branco de `inicio`.
 */
export const STARTER_SKELETON = "programa\n{\n    funcao inicio()\n    {\n        \n    }\n}\n";

/**
 * SHA-256 de `STARTER_SKELETON`. Se o esqueleto mudar, recalcular:
 * `printf 'programa\n{\n    funcao inicio()\n    {\n        \n    }\n}\n' | shasum -a 256`.
 */
export const STARTER_SKELETON_SHA256 = "a7b0dbe0c53ab293828821a796bd27b78404b1a379e7fd42787906b71118ca2a";

/**
 * Enunciados para escrever do zero (pré-código desligado). O do apêndice fala de «o programa a
 * seguir» e manda corrigir defeitos, o que não faz sentido diante de uma aba vazia, e chegaria
 * assim ao tutor como `problemStatement`. Mesma tarefa, mesmos limites, e o formato da saída
 * dito por extenso: sem o código na tela, é o único lugar onde o estudante vê que os casos de
 * teste procuram, por exemplo, «Media = » ou «7 e impar», sem acento. Ficam aqui, e não no
 * ficheiro gerado, porque não vêm do banco da bancada.
 */
const FROM_SCRATCH_STATEMENTS: Readonly<Record<number, string>> = {
  1: "Escreva um programa que leia três números reais e escreva a média aritmética desses valores, no formato “Media = valor” (sem acento).",
  2: "Escreva um programa que leia a nota final de um estudante (real, de 0 a 10) e escreva “Aprovado” ou “Reprovado”, considerando aprovado quem obtiver nota maior ou igual a 6,0.",
  3: "Escreva um programa que leia um inteiro N (1 ≤ N ≤ 10) e imprima a tabuada de N, de N x 1 até N x 10, uma linha por produto, no formato “N x i = p”.",
  4: "Escreva um programa que leia cinco inteiros, um de cada vez, e informe, para cada um, se é par ou ímpar, escrevendo uma linha no formato “numero e par” ou “numero e impar” (sem acento; por exemplo, “7 e impar”).",
  5: "Escreva um programa que leia um inteiro n (3 ≤ n ≤ 10), leia n números inteiros em um vetor e imprima o maior valor, no formato “Maior valor: m”.",
  6: "Escreva um programa que leia um inteiro n (3 ≤ n ≤ 15), leia n inteiros em um vetor e imprima quantos elementos são ímpares e maiores que 10, no formato “Quantidade: q”.",
};

/**
 * Material da tarefa. `starterCode` só vale para os cenários (o treino entrega sempre o código):
 * desligado, a aba abre com o esqueleto vazio e o enunciado é o de escrever do zero; os casos de
 * teste do **Concluí** são os mesmos.
 */
export function taskMaterial(index: number, starterCode = true): TaskMaterial | undefined {
  if (index === 0) {
    return PRACTICE_MATERIAL;
  }
  const item = STUDY_TASK_MATERIAL[index];
  if (item === undefined) {
    return undefined;
  }
  if (starterCode) {
    return { ...item, starterCode: true };
  }
  return {
    ...item,
    statement: FROM_SCRATCH_STATEMENTS[index] ?? item.statement,
    code: STARTER_SKELETON,
    codeSha256: STARTER_SKELETON_SHA256,
    starterCode: false,
  };
}
