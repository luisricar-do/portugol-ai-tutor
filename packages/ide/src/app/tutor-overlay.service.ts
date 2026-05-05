import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class TutorOverlayService {
  private readonly openSignal = signal(false);
  private readonly dimmedSignal = signal(false);

  /** Indica se o HUD flutuante do tutor está visível. */
  readonly isOpen = this.openSignal.asReadonly();

  /**
   * Retirada estratégica: HUD mais translúcido enquanto o aluno edita o código
   * (reativado com hover ou ao voltar ao chat).
   */
  readonly isDimmed = this.dimmedSignal.asReadonly();

  show(): void {
    this.openSignal.set(true);
    this.dimmedSignal.set(false);
  }

  hide(): void {
    this.openSignal.set(false);
    this.dimmedSignal.set(false);
  }

  /** Alterna visibilidade (ex.: ⌘K / Ctrl+K) — mesmo HUD que {@link show}. */
  toggle(): void {
    if (this.openSignal()) {
      this.hide();
    } else {
      this.show();
    }
  }

  dim(): void {
    if (this.openSignal()) {
      this.dimmedSignal.set(true);
    }
  }

  undim(): void {
    this.dimmedSignal.set(false);
  }
}
