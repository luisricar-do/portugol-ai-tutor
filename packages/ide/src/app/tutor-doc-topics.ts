/**
 * Mapa dos tópicos de documentação sugeridos pela ADA (backend: tool `suggest_documentation`)
 * para a página de ajuda correspondente na IDE (árvore de `packages/resources/ajuda/topicos.json`, campo `arquivo`).
 *
 * O backend só conhece o *slug* do tópico; a IDE é dona de *onde* a doc mora e de como abri-la.
 * Manter os slugs em sincronia com a tool `suggest_documentation` em `agents/strategist.py`.
 */
export interface DocTopic {
  /**
   *  * Slug emitido pelo backend.
   */
  slug: string;
  /**
   *  * Título curto exibido no link dentro do chat.
   */
  title: string;
  /**
   *  * Caminho do tópico, o `arquivo` de `topicos.json` (relativo a `assets/recursos/ajuda/`).
   */
  href: string;
}

const DOC_TOPICS: readonly DocTopic[] = [
  { slug: "variaveis", title: "Variáveis", href: "topicos/linguagem_portugol/declaracoes/variavel.md" },
  { slug: "tipos", title: "Tipos de dados", href: "topicos/linguagem_portugol/tipos/index.md" },
  { slug: "escreva", title: "escreva (saída)", href: "topicos/linguagem_portugol/entrada_saida/escreva.md" },
  { slug: "leia", title: "leia (entrada)", href: "topicos/linguagem_portugol/entrada_saida/leia.md" },
  {
    slug: "se_senao",
    title: "se / senão",
    href: "topicos/linguagem_portugol/estruturas_controle/desvio/se_senao.md",
  },
  {
    slug: "enquanto",
    title: "Laço enquanto",
    href: "topicos/linguagem_portugol/estruturas_controle/repeticao/enquanto.md",
  },
  { slug: "para", title: "Laço para", href: "topicos/linguagem_portugol/estruturas_controle/repeticao/para.md" },
  { slug: "vetores", title: "Vetores", href: "topicos/linguagem_portugol/declaracoes/vetor.md" },
  { slug: "matrizes", title: "Matrizes", href: "topicos/linguagem_portugol/declaracoes/matriz.md" },
] as const;

const DOC_TOPICS_BY_SLUG = new Map<string, DocTopic>(DOC_TOPICS.map(t => [t.slug, t]));

/**
 * Prefixo do href interno usado nos links de doc dentro das mensagens da ADA (interceptado no chat).
 * Usa apenas caracteres URL-safe (hífen/underscore) para não ser percent-encodado pelo sanitizador
 * do markdown — os slugs de tópico usam underscore (ex.: "se_senao").
 */
export const DOC_LINK_SCHEME = "#doc-";

/**
 *  * Resolve um slug (ex.: "vetores") para o tópico de doc, normalizando espaços/caixa.
 */
export function resolveDocTopic(slug: unknown): DocTopic | undefined {
  if (typeof slug !== "string") {
    return undefined;
  }
  return DOC_TOPICS_BY_SLUG.get(slug.trim().toLowerCase());
}

/**
 *  * Extrai o slug de um href de link de doc (ex.: "#doc:vetores" -> "vetores").
 */
export function docSlugFromHref(href: string | null | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  const idx = href.indexOf(DOC_LINK_SCHEME);
  if (idx === -1) {
    return undefined;
  }
  const slug = href.slice(idx + DOC_LINK_SCHEME.length).trim();
  return slug.length > 0 ? slug : undefined;
}
