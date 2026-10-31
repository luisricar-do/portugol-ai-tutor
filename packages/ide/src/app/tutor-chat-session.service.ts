import { Service, computed, inject, signal } from "@angular/core";
import type { TutorHistoryItem } from "@luisricar-do/agent";
import { Subject } from "rxjs";

import { TutorOverlayService } from "./tutor-overlay.service";

const MANY_EXECUTION_ATTEMPTS = 3;
const MIN_USER_TURNS_FOR_LOGIC_ENCOURAGEMENT = 2;

/**
 * Janela em que o mesmo gatilho proativo (compilação ou execução) não dispara de novo pelo
 * mesmo motivo. Sem ela cada execução falha abria o HUD e mandava outra fala ao tutor.
 */
const PROACTIVE_COOLDOWN_MS = 60_000;

export type ProactiveTriggerSource = "compile" | "runtime";

/**
 *  * Estado leve do diálogo do tutor no HUD (partilhado entre gatilhos proativos e telemetria).
 */
@Service()
export class TutorChatSessionService {
  private readonly tutorOverlay = inject(TutorOverlayService);

  private readonly userMessageCountSignal = signal(0);

  private readonly dialogTurnCountSignal = signal(0);

  private readonly successfulRunAfterManyAttemptsSubject = new Subject<void>();

  private executionAttemptsInSession = 0;

  private blockingErrorAttemptsInSession = 0;

  private successfulRunEncouragementSent = false;

  /**
   * Resposta da ADA em andamento (posto pelo chat). Gatilho proativo nesse intervalo abriria o
   * HUD por cima de uma resposta que ainda está chegando, e a fala seria descartada pelo chat.
   */
  private readonly respondingSignal = signal(false);

  private readonly lastProactiveTrigger = new Map<ProactiveTriggerSource, { key: string; at: number }>();

  readonly userMessageCount = this.userMessageCountSignal.asReadonly();

  readonly dialogTurnCount = this.dialogTurnCountSignal.asReadonly();

  readonly successfulRunAfterManyAttempts$ = this.successfulRunAfterManyAttemptsSubject.asObservable();

  /**
   * Turnos totais (utilizador + assistente) no histórico actual.
   */
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

  setResponding(responding: boolean): void {
    this.respondingSignal.set(responding);
  }

  /**
   * Cooldown comum aos gatilhos proativos: `false` se a mesma fonte já disparou pelo mesmo
   * motivo (`key`) há menos de {@link PROACTIVE_COOLDOWN_MS}. Quando devolve `true`, a tentativa
   * conta — mesmo que o disparo seja depois barrado por {@link canAcceptProactivePrompt}.
   */
  claimProactiveTrigger(source: ProactiveTriggerSource, key: string, now = Date.now()): boolean {
    const last = this.lastProactiveTrigger.get(source);
    if (last && last.key === key && now - last.at < PROACTIVE_COOLDOWN_MS) {
      return false;
    }
    this.lastProactiveTrigger.set(source, { key, at: now });
    return true;
  }

  /**
   * M03: gatilho proativo (compilação ou execução) só se a ADA não está respondendo e o HUD
   * está fechado ou o aluno ainda não enviou mensagens (boas-vindas da ADA não contam).
   */
  canAcceptProactivePrompt(): boolean {
    if (this.respondingSignal()) {
      return false;
    }
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
