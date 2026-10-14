/**
 * Identidade do participante na coleta de uso real (dissertação).
 *
 * O estudante digita a matrícula; o que sai do navegador é um pseudônimo derivado dela. O número
 * nunca é gravado nem enviado: nem a fila de telemetria nem o serviço do tutor o recebem. A
 * vinculação volta a ser feita só por quem tem a lista de matrículas (planilha do pesquisador),
 * recalculando o pseudônimo de cada uma com `scripts/pseudonimos.mjs`.
 *
 * O sal é público (vai no pacote), por isso o pseudônimo não resiste a quem tenha o conjunto de
 * dados *e* uma lista de matrículas: o conjunto que se publica é repseudonimizado antes.
 */

/**
 * Mudar o sal muda todos os pseudônimos: é coleta nova, não correção.
 */
export const STUDY_PSEUDONYM_SALT = "maieutica:uso-real:v1";

const PSEUDONYM_PREFIX = "m-";
const PSEUDONYM_HEX_LENGTH = 12;
const MATRICULA_MIN_LENGTH = 4;
const MATRICULA_MAX_LENGTH = 20;

/**
 * Forma canônica da matrícula: só letras e dígitos, em maiúsculas. Assim `2024.0012-34` e
 * `2024001234` dão o mesmo pseudônimo. Devolve `undefined` se o resultado não parecer matrícula.
 */
export function normalizeMatricula(raw: string): string | undefined {
  const canonical = raw
    .normalize("NFKC")
    .toUpperCase()
    .replaceAll(/[^\dA-Z]/g, "");
  if (canonical.length < MATRICULA_MIN_LENGTH || canonical.length > MATRICULA_MAX_LENGTH) {
    return undefined;
  }
  return canonical;
}

/**
 * `m-` + 12 hexadecimais de SHA-256(sal + matrícula canônica). Só `[a-z0-9-]`, como o
 * servidor exige para identificadores.
 */
export async function pseudonymFromMatricula(
  raw: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string | undefined> {
  const matricula = normalizeMatricula(raw);
  if (matricula === undefined) {
    return undefined;
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`${STUDY_PSEUDONYM_SALT}:${matricula}`));
  // eslint-disable-next-line unicorn/prefer-uint8array-hex -- `toHex()` só existe nos navegadores de 2025 em diante; os do laboratório podem ser anteriores.
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${PSEUDONYM_PREFIX}${hex.slice(0, PSEUDONYM_HEX_LENGTH)}`;
}

/**
 * Últimos quatro caracteres, para o estudante conferir na tela o que digitou sem que o número
 * inteiro fique à vista nem guardado.
 */
export function maskMatricula(raw: string): string | undefined {
  const matricula = normalizeMatricula(raw);
  return matricula === undefined ? undefined : `…${matricula.slice(-4)}`;
}

/**
 * FNV-1a de 32 bits: semente estável para o sorteio a partir de qualquer identificador.
 */
function seedFrom(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash;
}

/**
 * Gerador mulberry32: suficiente para embaralhar seis itens de forma reprodutível.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Ordem sorteada dos cenários para um participante (Fisher–Yates com semente no identificador).
 * O mesmo participante recebe sempre a mesma ordem, inclusive depois de recarregar a aba, e a
 * ordem pode ser refeita na análise a partir do pseudônimo.
 */
export function studyTaskOrder(participantId: string, taskIndices: readonly number[]): number[] {
  const order = [...taskIndices];
  const random = mulberry32(seedFrom(participantId));
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const current = order[index];
    order[index] = order[swap];
    order[swap] = current;
  }
  return order;
}
