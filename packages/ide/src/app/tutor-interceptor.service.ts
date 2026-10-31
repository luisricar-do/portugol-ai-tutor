import { Service, inject } from "@angular/core";
import { TutorAutoTriggerService } from "./tutor-auto-trigger.service";
import { TutorChatSessionService } from "./tutor-chat-session.service";
import { TutorImmersionService } from "./tutor-immersion.service";
import { tutorRuntimeErrorPrompt } from "./tutor-messages";
import { TutorOverlayService } from "./tutor-overlay.service";

/**
 * Centraliza a reação a falhas de execução: imersão + painel do tutor + mensagem inicial ao grafo.
 *
 * Mesmas travas do gatilho de compilação ({@link TutorChatSessionService}): cooldown, nada com a
 * ADA respondendo nem com o aluno já conversando no HUD aberto. Sem elas cada erro de execução
 * reabria o painel e entrava como fala do aluno no histórico, no meio da conversa.
 */
@Service()
export class TutorInterceptorService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);
  private readonly chatSession = inject(TutorChatSessionService);

  /**
   * `detail`: a mensagem do erro de execução, como o console a mostra (`⛔ …`). Vai na fala
   * proativa, não em `errors`: o serviço classifica o movimento pelos erros de compilação.
   */
  onExecutionFailed(isActiveTab: boolean, detail?: string): void {
    if (!isActiveTab) {
      return;
    }
    // Mesmo erro repetido dentro do cooldown não dispara de novo; outro erro dispara.
    if (!this.chatSession.claimProactiveTrigger("runtime", detail?.trim() ?? "")) {
      return;
    }
    if (!this.chatSession.canAcceptProactivePrompt()) {
      return;
    }
    this.immersion.setFocusMode(true);
    this.tutorOverlay.show();
    this.tutorAutoTrigger.emitUserMessage(tutorRuntimeErrorPrompt(detail));
  }
}
