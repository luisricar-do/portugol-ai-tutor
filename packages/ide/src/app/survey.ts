/**
 * Pesquisa com quem usa o IDE. Sem `url`, nada aparece: nem o convite ao abrir o IDE, nem o
 * link no Sobre. Depois de `until`, os dois somem sozinhos.
 */
export const SURVEY = {
  /**
   * Identifica a pesquisa no navegador: com outro `id`, quem respondeu a anterior é convidado
   * de novo.
   */
  id: "2026-perfil",

  /**
   * Endereço do formulário.
   */
  url: "",

  /**
   * Último dia do convite (até o fim do dia, no horário de quem usa).
   */
  until: "2026-12-31",
};
