import { JsonPipe } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Injector,
  Input,
  NgZone,
  viewChild,
} from "@angular/core";
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
import { EditorActionsService } from "../editor-actions.service";

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

  /**
   * Erros do compilador no momento do envio (ex.: `checkCode` no worker).
   * Se não existir, usa `compilerErrorsSnapshot` quando definido.
   */
  @Input() compilerErrorsResolver?: () => Promise<string[]>;

  /** Fallback síncrono (ex.: marcadores Monaco) quando não há resolver. */
  @Input() compilerErrorsSnapshot?: () => string[];

  readonly baseUrlConfigured = Boolean(environment.agentApiBaseUrl?.trim());

  readonly scrollArea = viewChild<ElementRef<HTMLElement>>("scrollArea");

  readonly threadEnd = viewChild<ElementRef<HTMLElement>>("threadEnd");

  private readonly ngZone = inject(NgZone);

  private readonly injector = inject(Injector);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly editorActionsService = inject(EditorActionsService);

  /** Tokens SSE acumulados até o próximo frame (evita NgZone/CD por caractere). */
  private streamingTokenBuffer = "";

  /** `requestAnimationFrame` pendente para aplicar `streamingTokenBuffer`. */
  private streamingTokenFlushRaf: number | null = null;

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

  /** Destaques/comentários do tutor ainda visíveis no editor (para UI ou lógica externa). */
  get activeTutorDecorationCount(): number {
    return this.editorActionsService.activeTutorDecorationCount;
  }

  /** Scroll leve durante streaming (um rAF; não empilha `afterNextRender`). */
  private scrollThreadToEndFast(): void {
    const scrollEl = this.scrollArea()?.nativeElement;
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
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

  /** Agenda aplicação dos tokens do stream no próximo frame (uma entrada na NgZone por frame). */
  private scheduleStreamingTokenFlush(): void {
    if (this.streamingTokenFlushRaf !== null) {
      return;
    }
    this.streamingTokenFlushRaf = requestAnimationFrame(() => {
      this.streamingTokenFlushRaf = null;
      const chunk = this.streamingTokenBuffer;
      if (chunk.length === 0) {
        return;
      }
      this.streamingTokenBuffer = "";
      this.ngZone.run(() => {
        this.streamingText += chunk;
        this.scrollThreadToEndFast();
        this.cdr.markForCheck();
      });
    });
  }

  private cancelStreamingTokenFlush(): void {
    if (this.streamingTokenFlushRaf !== null) {
      cancelAnimationFrame(this.streamingTokenFlushRaf);
      this.streamingTokenFlushRaf = null;
    }
  }

  private codeForRequest(): string {
    const raw = this.editorCodeSnapshot?.() ?? this.editorCode ?? "";
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : TUTOR_CHAT_PLACEHOLDER_CODE;
  }

  private async errorsForRequest(): Promise<string[]> {
    if (this.compilerErrorsResolver) {
      try {
        const withTimeout = new Promise<string[]>(resolve => {
          setTimeout(() => {
            resolve(this.compilerErrorsSnapshot?.() ?? []);
          }, 1200);
        });
        return await Promise.race([this.compilerErrorsResolver(), withTimeout]);
      } catch {
        return this.compilerErrorsSnapshot?.() ?? [];
      }
    }
    return this.compilerErrorsSnapshot?.() ?? [];
  }

  onDraftEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey || ke.isComposing) {
      return;
    }

    ke.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || !this.baseUrlConfigured || this.streamingAssistant) {
      return;
    }

    // Não passar `runInZone`: o cliente chamaria NgZone por cada token SSE e saturava o ciclo de detecção
    // de mudanças (sintoma: UI “travada” até abrir DevTools). O batching abaixo entra na zona no máx. ~60/s.
    const client = createTutorAgentClient({
      baseUrl: environment.agentApiBaseUrl,
    });

    // Atualiza o estado na zona do Angular *antes* do await do worker, para haver CD imediata
    // e evitar múltiplos envios enquanto `errorsForRequest` está pendente.
    this.ngZone.run(() => {
      this.history.push({ role: "user", content: text });
      this.draft = "";
      this.error = null;
      this.streamingAssistant = true;
      this.streamingText = "";
      this.scrollThreadToEnd();
    });

    const errors = await this.errorsForRequest();

    this.streamingTokenBuffer = "";

    void client
      .helpStream(
        {
          code: this.codeForRequest(),
          errors,
          history: this.history,
          activeTutorDecorations: this.editorActionsService.activeTutorDecorationCount,
        },
        {
          onDiagnosis: diagnosis => {
            this.ngZone.run(() => {
              this.lastDiagnosis = diagnosis;
              this.cdr.markForCheck();
            });
          },
          onToken: delta => {
            this.streamingTokenBuffer += delta;
            this.scheduleStreamingTokenFlush();
          },
          // Ações do editor são enfileiradas no EditorActionsService (rAF + NgZone) para não bloquear
          // o thread principal durante o SSE — evita competir com o worker de transpilação.
          onAction: action => {
            this.editorActionsService.dispatch(action);
          },
          onDone: () => {
            this.ngZone.run(() => {
              this.cancelStreamingTokenFlush();
              if (this.streamingTokenBuffer.length > 0) {
                this.streamingText += this.streamingTokenBuffer;
                this.streamingTokenBuffer = "";
              }
              const reply = this.streamingText;
              this.streamingAssistant = false;
              this.streamingText = "";
              if (reply.length > 0) {
                this.history.push({ role: "assistant", content: reply });
              }
              this.scrollThreadToEnd();
              this.cdr.markForCheck();
            });
          },
        },
      )
      .catch((error: unknown) => {
        this.ngZone.run(() => {
          this.cancelStreamingTokenFlush();
          this.streamingTokenBuffer = "";
          this.streamingAssistant = false;
          this.streamingText = "";
          this.history.pop();
          this.error = error instanceof TutorAgentError ? error.message : "Falha ao contactar o tutor.";
          this.scrollThreadToEnd();
          this.cdr.markForCheck();
        });
      });
  }

  clearConversation(): void {
    this.cancelStreamingTokenFlush();
    this.streamingTokenBuffer = "";
    this.history = [];
    this.lastDiagnosis = null;
    this.error = null;
    this.streamingAssistant = false;
    this.streamingText = "";
    this.editorActionsService.clearTutorDecorations();
  }
}
