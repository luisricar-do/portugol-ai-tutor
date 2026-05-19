import { Injectable, inject } from "@angular/core";
import type { PortugolCodeError } from "@luisricar-do/antlr";

import { TutorAutoTriggerService } from "./tutor-auto-trigger.service";
import { TutorChatSessionService } from "./tutor-chat-session.service";
import { TutorImmersionService } from "./tutor-immersion.service";
import { TUTOR_COMPILE_RUN_PROMPT } from "./tutor-messages";
import { TutorOverlayService } from "./tutor-overlay.service";
import { TutorTelemetryService } from "./tutor-telemetry.service";

const COOLDOWN_MS = 60_000;

/**
 * Reação a erros de compilação após o aluno executar o programa (não a cada keystroke).
 */
@Injectable({ providedIn: "root" })
export class TutorCompileTriggerService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);
  private readonly chatSession = inject(TutorChatSessionService);
  private readonly telemetry = inject(TutorTelemetryService);

  private lastErrorHash = "";
  private lastTriggeredAt = 0;

  onRunWithCompileErrors(errors: PortugolCodeError[], isActiveTab: boolean): void {
    if (!isActiveTab || errors.length === 0) {
      return;
    }

    const hash = errors
      .map(e => `${e.startLine}:${e.startCol}:${e.message}`)
      .sort()
      .join("|");
    const now = Date.now();
    if (hash === this.lastErrorHash && now - this.lastTriggeredAt < COOLDOWN_MS) {
      return;
    }
    this.lastErrorHash = hash;
    this.lastTriggeredAt = now;

    if (!this.chatSession.canAcceptProactiveCompilePrompt()) {
      this.telemetry.log({ type: "compile_trigger_skipped_active_chat" });
      return;
    }

    const focusLine = errors[0]?.startLine;
    this.immersion.setFocusMode(true);
    this.tutorOverlay.show(
      typeof focusLine === "number" && focusLine >= 1 ? { focusLine } : undefined,
    );
    this.telemetry.log({ type: "compile_trigger_fired" });
    this.tutorAutoTrigger.emitUserMessage(TUTOR_COMPILE_RUN_PROMPT);
  }
}
