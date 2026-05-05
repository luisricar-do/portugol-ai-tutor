import { Injectable, inject } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import { TutorOverlayService } from "./tutor-overlay.service";

const DEFAULT_MS = 180_000; // 3 min

/**
 * Proatividade leve: após inatividade com erros no editor, abre o tutor e sugere ajuda (sem chamar a API sozinha).
 */
@Injectable({ providedIn: "root" })
export class TutorProactivityService {
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly snack = inject(MatSnackBar);

  private timerId: ReturnType<typeof setTimeout> | null = null;

  private lastHasErrors = false;

  /** Reinicia o temporizador quando o utilizador edita ou muda o estado de erros. */
  resetWatch(hasCompilerErrors: boolean): void {
    this.clearTimer();
    this.lastHasErrors = hasCompilerErrors;
    if (!hasCompilerErrors) {
      return;
    }
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.lastHasErrors && !this.tutorOverlay.isOpen()) {
        this.snack.open(
          "Ainda há erros no código. O tutor ARIA pode ajudar com perguntas — sem entregar a solução pronta.",
          "OK",
          { duration: 7000, panelClass: ["tutor-snack", "tutor-snack--nudge"] },
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
