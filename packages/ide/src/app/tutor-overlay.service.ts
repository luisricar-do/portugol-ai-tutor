import { Injectable, computed, signal } from "@angular/core";

/** Estados da HUD + editor descritos no desenho pedagógico (Idle / Foco / Observador). */
export type TutorUiState = "closed" | "socratic" | "observer";

@Injectable({ providedIn: "root" })
export class TutorOverlayService {
  private readonly openSignal = signal(false);
  private readonly dimmedSignal = signal(false);
  private readonly pendingFocusLineSignal = signal<number | null>(null);
  /** Borda verde discreta após correção de erros de compilação (sem auto-fechar o HUD). */
  private readonly successCelebrationSignal = signal(false);

  /** Indica se o HUD flutuante do tutor está visível. */
  readonly isOpen = this.openSignal.asReadonly();

  /**
   * Retirada estratégica: HUD mais translúcido enquanto o aluno edita o código
   * (reativado com hover ou ao voltar ao chat).
   */
  readonly isDimmed = this.dimmedSignal.asReadonly();

  /** `closed` · `socratic` (HUD focado) · `observer` (HUD fantasma ao editar). */
  readonly uiState = computed<TutorUiState>(() => {
    if (!this.openSignal()) {
      return "closed";
    }
    return this.dimmedSignal() ? "observer" : "socratic";
  });

  readonly isSuccessCelebration = this.successCelebrationSignal.asReadonly();

  show(options?: { focusLine?: number }): void {
    this.openSignal.set(true);
    this.dimmedSignal.set(false);
    const ln = options?.focusLine;
    if (typeof ln === "number" && Number.isFinite(ln) && ln >= 1) {
      this.pendingFocusLineSignal.set(Math.trunc(ln));
    } else {
      this.pendingFocusLineSignal.set(null);
    }
  }

  /**
   * Linha alvo para scroll ao abrir (consumido uma vez pelo editor da aba ativa).
   */
  takePendingFocusLine(): number | null {
    const v = this.pendingFocusLineSignal();
    this.pendingFocusLineSignal.set(null);
    return v;
  }

  hide(): void {
    this.openSignal.set(false);
    this.dimmedSignal.set(false);
    this.pendingFocusLineSignal.set(null);
    this.successCelebrationSignal.set(false);
  }

  /**
   * Celebra correção do código (erros de compilação eliminados): borda verde discreta.
   * O HUD permanece aberto para o aluno ler a mensagem reflexiva.
   */
  beginSuccessCelebration(): void {
    if (!this.openSignal()) {
      return;
    }
    this.successCelebrationSignal.set(true);
  }

  clearSuccessCelebration(): void {
    this.successCelebrationSignal.set(false);
  }

  /** Alterna visibilidade (ex.: ⌘⇧A / Ctrl+Shift+A) — mesmo HUD que {@link show}. */
  toggle(options?: { focusLine?: number }): void {
    if (this.openSignal()) {
      this.hide();
    } else {
      this.show(options);
    }
  }

  dim(): void {
    if (!this.openSignal() || this.dimmedSignal()) {
      return;
    }
    this.dimmedSignal.set(true);
  }

  undim(): void {
    if (!this.dimmedSignal()) {
      return;
    }
    this.dimmedSignal.set(false);
  }
}
