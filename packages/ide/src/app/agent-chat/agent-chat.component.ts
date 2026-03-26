import { JsonPipe } from "@angular/common";
import { afterNextRender, Component, ElementRef, inject, Injector, Input, NgZone, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import {
  createTutorAgentClient,
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError,
  type TutorDiagnosis,
  type TutorHistoryItem,
} from "@luisricar-do/agent";
import { AngularSvgIconModule } from "angular-svg-icon";

import { environment } from "../../environments/environment";

@Component({
  selector: "app-agent-chat",
  imports: [AngularSvgIconModule, FormsModule, JsonPipe, MatButtonModule, MatCheckboxModule],
  standalone: true,
  templateUrl: "./agent-chat.component.html",
  styleUrl: "./agent-chat.component.scss",
})
export class AgentChatComponent {
  /** Valor espelhado do editor (pode atrasar face ao Monaco). */
  @Input() editorCode = "";

  /**
   * Se definido, o texto enviado ao tutor usa o retorno desta função no momento do envio
   * (ex.: `getModel().getValue()`), garantindo o código atualmente aberto no editor.
   */
  @Input() editorCodeSnapshot?: () => string;

  readonly baseUrlConfigured = Boolean(environment.agentApiBaseUrl?.trim());

  readonly scrollArea = viewChild<ElementRef<HTMLElement>>("scrollArea");

  readonly threadEnd = viewChild<ElementRef<HTMLElement>>("threadEnd");

  private readonly ngZone = inject(NgZone);

  private readonly injector = inject(Injector);

  draft = "";
  error: string | null = null;
  showDiagnosis = false;
  lastDiagnosis: TutorDiagnosis | null = null;

  /** Resposta em andamento via SSE (`/help/stream`). */
  streamingAssistant = false;
  streamingText = "";

  private history: TutorHistoryItem[] = [];

  get thread(): TutorHistoryItem[] {
    return this.history;
  }

  get hasHistory(): boolean {
    return this.history.length > 0;
  }

  /** Após o DOM refletir novas mensagens / streaming, leva o scroll ao fundo do thread. */
  private scrollThreadToEnd(): void {
    afterNextRender(
      () => {
        requestAnimationFrame(() => {
          const scrollEl = this.scrollArea()?.nativeElement;
          const anchor = this.threadEnd()?.nativeElement;
          if (anchor && scrollEl?.contains(anchor)) {
            anchor.scrollIntoView({ block: "end", inline: "nearest", behavior: "instant" });
          } else if (scrollEl) {
            scrollEl.scrollTop = scrollEl.scrollHeight;
          }
          requestAnimationFrame(() => {
            if (scrollEl) {
              scrollEl.scrollTop = scrollEl.scrollHeight;
            }
          });
        });
      },
      { injector: this.injector },
    );
  }

  private codeForRequest(): string {
    const raw = this.editorCodeSnapshot?.() ?? this.editorCode ?? "";
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : TUTOR_CHAT_PLACEHOLDER_CODE;
  }

  onDraftEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey || ke.isComposing) {
      return;
    }

    ke.preventDefault();
    this.send();
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || !this.baseUrlConfigured || this.streamingAssistant) {
      return;
    }

    const client = createTutorAgentClient({ baseUrl: environment.agentApiBaseUrl });
    this.history.push({ role: "user", content: text });
    this.draft = "";
    this.error = null;
    this.streamingAssistant = true;
    this.streamingText = "";
    this.scrollThreadToEnd();

    void client
      .helpStream(
        {
          code: this.codeForRequest(),
          errors: [],
          history: this.history,
        },
        {
          onDiagnosis: diagnosis => {
            this.ngZone.run(() => {
              this.lastDiagnosis = diagnosis;
            });
          },
          onToken: delta => {
            this.ngZone.run(() => {
              this.streamingText += delta;
              this.scrollThreadToEnd();
            });
          },
          onDone: () => {
            this.ngZone.run(() => {
              const reply = this.streamingText;
              this.streamingAssistant = false;
              this.streamingText = "";
              if (reply.length > 0) {
                this.history.push({ role: "assistant", content: reply });
              }
              this.scrollThreadToEnd();
            });
          },
        },
      )
      .catch((error: unknown) => {
        this.ngZone.run(() => {
          this.streamingAssistant = false;
          this.streamingText = "";
          this.history.pop();
          this.error = error instanceof TutorAgentError ? error.message : "Falha ao contactar o tutor.";
          this.scrollThreadToEnd();
        });
      });
  }

  clearConversation(): void {
    this.history = [];
    this.lastDiagnosis = null;
    this.error = null;
    this.streamingAssistant = false;
    this.streamingText = "";
  }
}
