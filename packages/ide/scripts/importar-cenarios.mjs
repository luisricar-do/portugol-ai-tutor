/**
 * Importa os seis cenários da dissertação do banco da bancada para a IDE de coleta.
 *
 * O código que a aba abre é o `bug_code` do item, que é também o estado `s0` com que a bancada
 * avalia o tutor: em uso real o estudante começa exatamente de onde começa a bancada. Copiar à
 * mão abriria espaço para divergência silenciosa; por isso o ficheiro gerado leva o id do item e
 * o SHA-256 do código, que seguem no evento `task_start`.
 *
 * O enunciado não entra no código. Ele aparece na barra da sessão e chega ao tutor em campo
 * próprio (`problemStatement`), como na bancada; um comentário no programa o faria chegar pelo
 * `code`, deslocando as linhas em relação ao `s0` e alimentando a leitura textual do movimento. O texto é o do apêndice de enunciados, com acentos; o `problem`
 * do banco é a mesma redação sem eles.
 *
 * Os `unit_tests` do item vêm junto: o **Concluí** só encerra a tarefa quando o programa passa
 * em todos, com a mesma regra de `_passou` em `avaliacao/estados.py`. Ficam no navegador, como o
 * enunciado: os casos de teste não vão ao serviço do tutor (invariante da bancada).
 *
 *   node packages/ide/scripts/importar-cenarios.mjs [pasta-do-banco]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const aqui = import.meta.dirname;
const banco = process.argv[2] ?? path.join(aqui, "../../../../maieutica-avaliacoes/avaliacao/banco");
const destino = path.join(aqui, "../src/app/study-tasks.gerado.ts");

const CENARIOS = [
  {
    index: 1,
    item: "tese_01_media",
    enunciado:
      "O programa a seguir deveria ler três números reais e escrever a média aritmética desses valores. Ele contém erros e não produz o resultado correto. Localize e corrija os defeitos para que o programa compile e calcule a média corretamente.",
  },
  {
    index: 2,
    item: "tese_02_aprovacao",
    enunciado:
      "O programa a seguir deveria ler a nota final de um estudante (real, de 0 a 10) e informar se ele está aprovado ou reprovado, considerando aprovado quem obtiver nota maior ou igual a 6,0. O programa compila, mas classifica erradamente alguns casos. Localize e corrija o defeito.",
  },
  {
    index: 3,
    item: "tese_03_tabuada",
    enunciado:
      "O programa a seguir deveria ler um inteiro N (1 ≤ N ≤ 10) e imprimir a tabuada de N, de N x 1 até N x 10, uma linha por produto, no formato “N x i = p”. Ao ser executado, o programa trava (não termina). Localize e corrija os defeitos.",
  },
  {
    index: 4,
    item: "tese_04_par_impar",
    enunciado:
      "O programa a seguir deveria ler cinco inteiros, um de cada vez, e informar, para cada um, se é par ou ímpar. O programa compila, mas a classificação sai errada. Localize e corrija os defeitos.",
  },
  {
    index: 5,
    item: "tese_05_maior_vetor",
    enunciado:
      "O programa a seguir deveria ler um inteiro n (3 ≤ n ≤ 10), ler n números inteiros em um vetor e imprimir o maior valor. O programa pede mais números do que os n solicitados e, em certos casos, interrompe a execução com falha de acesso ao vetor ou imprime um valor que não pertence à lista digitada. Localize e corrija os defeitos.",
  },
  {
    index: 6,
    item: "tese_06_contagem",
    enunciado:
      "O programa a seguir deveria ler um inteiro n (3 ≤ n ≤ 15), ler n inteiros em um vetor e imprimir quantos elementos são ímpares e maiores que 10. Ele compila e executa, mas devolve a contagem errada. Localize e corrija o defeito.",
  },
];

const entradas = CENARIOS.map(({ index, item, enunciado }) => {
  const dados = JSON.parse(readFileSync(path.join(banco, `${item}.json`), "utf8"));
  const s0 = dados.estados_codigo?.find(estado => estado.id === "s0");
  if (dados.id !== item || typeof dados.bug_code !== "string") {
    throw new Error(`${item}: item inválido no banco`);
  }
  if (s0 && s0.codigo !== dados.bug_code) {
    throw new Error(`${item}: bug_code difere do estado s0; o banco precisa ser corrigido antes`);
  }
  if (!Array.isArray(dados.unit_tests) || dados.unit_tests.length === 0) {
    throw new Error(`${item}: item sem unit_tests`);
  }
  const casos = dados.unit_tests.map((caso, posicao) => {
    if (!Array.isArray(caso.entrada) || typeof caso.saida_contem !== "string") {
      throw new TypeError(`${item}: caso ${posicao} sem entrada ou saida_contem`);
    }
    return {
      input: caso.entrada.map(String),
      expectedContains: caso.saida_contem,
      ...(typeof caso.saida_nao_contem === "string" && { expectedNotContains: caso.saida_nao_contem }),
    };
  });
  const sha = createHash("sha256").update(dados.bug_code).digest("hex");
  return `  ${index}: {
    bankItem: ${JSON.stringify(item)},
    statement: ${JSON.stringify(enunciado)},
    code: ${JSON.stringify(dados.bug_code)},
    codeSha256: ${JSON.stringify(sha)},
    tests: ${JSON.stringify(casos)},
  },`;
});

writeFileSync(
  destino,
  `// Gerado por scripts/importar-cenarios.mjs a partir do banco da bancada — não editar manualmente.

/**
 * Um \`unit_test\` do item: entradas dos \`leia\`, na ordem, e o que a saída deve (ou não) conter.
 */
export interface StudyTestCase {
  readonly input: readonly string[];
  readonly expectedContains: string;
  readonly expectedNotContains?: string;
}

export interface StudyTaskMaterial {
  /**
   * Id do item no banco (\`maieutica-avaliacoes/avaliacao/banco\`).
   */
  readonly bankItem: string;
  /**
   * Enunciado do apêndice, mostrado na barra e enviado ao tutor como problemStatement.
   */
  readonly statement: string;
  /**
   * Código defeituoso: o \`bug_code\` do item, igual ao estado \`s0\` da bancada.
   */
  readonly code: string;
  readonly codeSha256: string;
  /**
   * Casos de teste do banco; o primeiro aparece como exemplo no enunciado.
   */
  readonly tests: readonly StudyTestCase[];
}

export const STUDY_TASK_MATERIAL: Readonly<Record<number, StudyTaskMaterial>> = {
${entradas.join("\n")}
};
`,
);

process.stdout.write(`${CENARIOS.length} cenários importados de ${banco}\n`);
