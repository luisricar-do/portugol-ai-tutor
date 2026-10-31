import { Service, inject } from "@angular/core";
import type { IPortugolCodeDiagnostic } from "@luisricar-do/antlr";

import { TutorAutoTriggerService } from "./tutor-auto-trigger.service";
import { TutorChatSessionService } from "./tutor-chat-session.service";
import { TutorImmersionService } from "./tutor-immersion.service";
import { TUTOR_COMPILE_RUN_PROMPT } from "./tutor-messages";
import { TutorOverlayService } from "./tutor-overlay.service";
import { TutorTelemetryService } from "./tutor-telemetry.service";

/**
 *  *  * Reação a erros de compilação após o aluno executar o programa (não a cada keystroke).
 */
@Service()
export class TutorCompileTriggerService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);
  private readonly chatSession = inject(TutorChatSessionService);
  private readonly telemetry = inject(TutorTelemetryService);

  onRunWithCompileErrors(errors: IPortugolCodeDiagnostic[], isActiveTab: boolean): void {
    if (!isActiveTab || errors.length === 0) {
      return;
    }

    const hash = errors
      .map(e => `${e.startLine}:${e.startCol}:${e.message}`)
      // eslint-disable-next-line unicorn/no-array-sort -- toSorted exige lib ES2023; o map já devolve cópia.
      .sort((a, b) => a.localeCompare(b))
      .join("|");
    if (!this.chatSession.claimProactiveTrigger("compile", hash)) {
      return;
    }

    if (!this.chatSession.canAcceptProactivePrompt()) {
      this.telemetry.log({ type: "compile_trigger_skipped_active_chat" });
      return;
    }

    const focusLine = errors[0]?.startLine;
    this.immersion.setFocusMode(true);
    this.tutorOverlay.show(typeof focusLine === "number" && focusLine >= 1 ? { focusLine } : undefined);
    this.telemetry.log({ type: "compile_trigger_fired" });
    this.tutorAutoTrigger.emitUserMessage(TUTOR_COMPILE_RUN_PROMPT);
  }
}
