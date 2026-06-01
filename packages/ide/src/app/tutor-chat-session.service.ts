import { Injectable, computed, inject, signal } from "@angular/core";
import type { TutorHistoryItem } from "@luisricar-do/agent";
import { Subject } from "rxjs";

import { TutorOverlayService } from "./tutor-overlay.service";

const MANY_EXECUTION_ATTEMPTS = 3;
const MIN_USER_TURNS_FOR_LOGIC_ENCOURAGEMENT = 2;

/**
 * Estado leve do diálogo do tutor no HUD (partilhado entre gatilhos proativos e telemetria).
 */
@Injectable({ providedIn: "root" })
export class TutorChatSessionService {
  private readonly tutorOverlay = inject(TutorOverlayService);

  private readonly userMessageCountSignal = signal(0);

  private readonly dialogTurnCountSignal = signal(0);

  private readonly successfulRunAfterManyAttemptsSubject = new Subject<void>();

  private executionAttemptsInSession = 0;

  private blockingErrorAttemptsInSession = 0;

  private successfulRunEncouragementSent = false;

  readonly userMessageCount = this.userMessageCountSignal.asReadonly();

  readonly dialogTurnCount = this.dialogTurnCountSignal.asReadonly();

  readonly successfulRunAfterManyAttempts$ = this.successfulRunAfterManyAttemptsSubject.asObservable();

  /** Turnos totais (utilizador + assistente) no histórico actual. */
  readonly messageCount = computed(() => this.dialogTurnCountSignal());

  syncFromHistory(history: readonly TutorHistoryItem[]): void {
    let userCount = 0;
    for (const item of history) {
      if (item.role === "user") {
        userCount++;
      }
    }
    this.userMessageCountSignal.set(userCount);
    this.dialogTurnCountSignal.set(history.length);
    if (history.length === 0) {
      this.resetExecutionAttempts();
    }
  }

  reset(): void {
    this.userMessageCountSignal.set(0);
    this.dialogTurnCountSignal.set(0);
    this.resetExecutionAttempts();
  }

  recordExecutionFinished(hadBlockingError: boolean, isActiveTab: boolean): void {
    if (!isActiveTab) {
      return;
    }

    this.executionAttemptsInSession++;
    if (hadBlockingError) {
      this.blockingErrorAttemptsInSession++;
      this.successfulRunEncouragementSent = false;
      return;
    }

    if (this.blockingErrorAttemptsInSession > 0) {
      this.resetExecutionAttempts();
      return;
    }

    if (
      this.tutorOverlay.isOpen() &&
      !this.successfulRunEncouragementSent &&
      this.userMessageCountSignal() >= MIN_USER_TURNS_FOR_LOGIC_ENCOURAGEMENT &&
      this.executionAttemptsInSession >= MANY_EXECUTION_ATTEMPTS
    ) {
      this.successfulRunEncouragementSent = true;
      this.executionAttemptsInSession = 0;
      this.successfulRunAfterManyAttemptsSubject.next();
    }
  }

  /**
   * M03: gatilho proativo após compilação só se o HUD estiver fechado ou o aluno
   * ainda não enviou mensagens (boas-vindas da ADA não contam).
   */
  canAcceptProactiveCompilePrompt(): boolean {
    if (!this.tutorOverlay.isOpen()) {
      return true;
    }
    return this.userMessageCountSignal() === 0;
  }

  private resetExecutionAttempts(): void {
    this.executionAttemptsInSession = 0;
    this.blockingErrorAttemptsInSession = 0;
    this.successfulRunEncouragementSent = false;
  }
}
