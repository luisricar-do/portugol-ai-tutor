import { Service, inject } from "@angular/core";
import { TutorOverlayService } from "./tutor-overlay.service";
import { TutorToastService } from "./tutor-toast.service";

const DEFAULT_MS = 180_000; // 3 min

/**
 *  *  * Proatividade leve: após inatividade com erros no editor, abre o tutor e sugere ajuda (sem chamar a API sozinha).
 */
@Service()
export class TutorProactivityService {
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly toast = inject(TutorToastService);

  private timerId: ReturnType<typeof setTimeout> | null = null;

  private lastHasErrors = false;

  /**
   *  *  * Reinicia o temporizador quando o utilizador edita ou muda o estado de erros.
   */
  resetWatch(hasCompilerErrors: boolean): void {
    this.clearTimer();
    this.lastHasErrors = hasCompilerErrors;
    if (!hasCompilerErrors) {
      return;
    }
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.lastHasErrors && !this.tutorOverlay.isOpen()) {
        this.toast.show(
          "Ainda há erros no código. A tutora ADA pode ajudar com perguntas — sem entregar a solução pronta.",
          { duration: 7000, variant: "nudge" },
        );
        this.tutorOverlay.show();
      }
    }, DEFAULT_MS);
  }

  clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
