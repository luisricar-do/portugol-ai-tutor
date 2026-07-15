import { Injectable, inject } from "@angular/core";
import { TutorAutoTriggerService } from "./tutor-auto-trigger.service";
import { TutorImmersionService } from "./tutor-immersion.service";
import { TutorOverlayService } from "./tutor-overlay.service";

/**
 * Centraliza a reação a falhas de execução: imersão + painel do tutor + mensagem inicial ao grafo.
 */
@Injectable({ providedIn: "root" })
export class TutorInterceptorService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);

  onExecutionFailed(isActiveTab: boolean): void {
    if (!isActiveTab) {
      return;
    }
    this.immersion.setFocusMode(true);
    this.tutorOverlay.show();
    this.tutorAutoTrigger.emitUserMessage(
      "O programa falhou ao executar. Pode me ajudar a entender o que aconteceu?",
    );
  }
}
