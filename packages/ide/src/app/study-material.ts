import { STUDY_TASK_MATERIAL } from "./study-tasks.gerado";

export interface TaskMaterial {
  /**
   * Mostrado na barra enquanto a tarefa corre; nunca enviado ao tutor.
   */
  readonly statement: string;
  /**
   * Programa que a aba abre.
   */
  readonly code: string;
  /**
   * Só nos cenários: o item do banco e o hash do código, que seguem no `task_start`.
   */
  readonly bankItem?: string;
  readonly codeSha256?: string;
}

/**
 * Treino da ambientação. Fica fora do banco, como pede o roteiro, e os dois defeitos não
 * coincidem com os dos seis cenários: um nome de variável digitado errado (erro de compilação)
 * e uma soma no lugar da subtração. Assim o treino mostra o erro do compilador, a execução e a
 * conversa com a Ada sem ensinar a correção de nenhum cenário da coleta.
 */
const PRACTICE_MATERIAL: TaskMaterial = {
  statement:
    "Exercício de treino (não conta para a pesquisa). O programa a seguir deveria ler o seu nome e o ano em que você nasceu e escrever quantos anos você completa em 2026. Ele não compila e, depois de corrigido isso, mostra uma idade errada. Experimente executar, ler o erro e conversar com a Ada. Localize e corrija os defeitos.",
  code: `programa
{
    funcao inicio()
    {
        cadeia nome
        inteiro ano_nascimento, idade

        escreva("Qual e o seu nome? ")
        leia(nome)
        escreva("Em que ano voce nasceu? ")
        leia(ano_nascimento)

        idade = 2026 + ano_nascimento
        escreva("Ola, ", nme, "! Em 2026 voce completa ", idade, " anos.\\n")
    }
}
`,
};

export function taskMaterial(index: number): TaskMaterial | undefined {
  return index === 0 ? PRACTICE_MATERIAL : STUDY_TASK_MATERIAL[index];
}
