import { Injectable, computed, inject, signal } from "@angular/core";
import type { TutorHistoryItem } from "@luisricar-do/agent";

import { TutorOverlayService } from "./tutor-overlay.service";

/**
 * Estado leve do diálogo do tutor no HUD (partilhado entre gatilhos proativos e telemetria).
 */
@Injectable({ providedIn: "root" })
export class TutorChatSessionService {
  private readonly tutorOverlay = inject(TutorOverlayService);

  private readonly userMessageCountSignal = signal(0);

  private readonly dialogTurnCountSignal = signal(0);

  readonly userMessageCount = this.userMessageCountSignal.asReadonly();

  readonly dialogTurnCount = this.dialogTurnCountSignal.asReadonly();

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
  }

  reset(): void {
    this.userMessageCountSignal.set(0);
    this.dialogTurnCountSignal.set(0);
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
}
