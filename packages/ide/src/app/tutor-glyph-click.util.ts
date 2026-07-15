/** Glifos ? clicáveis na margem do editor (abrem a tutora). */
export const TUTOR_CLICKABLE_GLYPH_CLASSES = ["tutor-glyph-compile-issue", "tutor-glyph-flow-broken"] as const;

export const TUTOR_GLYPH_HOVER_MESSAGE = "Pedir ajuda da tutora nesta linha";

export function lineHasClickableTutorGlyph(
  decorations: ReadonlyArray<{ options: { glyphMarginClassName?: string | null } }> | null | undefined,
): boolean {
  if (!decorations?.length) {
    return false;
  }
  return decorations.some(d => {
    const cls = d.options.glyphMarginClassName ?? "";
    return TUTOR_CLICKABLE_GLYPH_CLASSES.some(token => cls.includes(token));
  });
}

/** Mensagem automática ao clicar no ? da margem. */
export function buildGlyphClickMessage(line: number, compilerMarkerMessage?: string): string {
  const trimmed = compilerMarkerMessage?.trim();
  if (trimmed) {
    return `Estou com dificuldade na linha ${line}: ${trimmed}. Pode me ajudar a entender?`;
  }
  return `Tenho dúvida sobre o fluxo de dados na linha ${line}. Pode me ajudar a entender?`;
}
