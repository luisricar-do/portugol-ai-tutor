import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  Input,
  NgZone,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  createTutorAgentClient,
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError,
  type TutorHistoryItem,
  type TutorStreamDonePayload,
} from "@luisricar-do/agent";
import { AngularSvgIconModule } from "angular-svg-icon";

import { environment } from "../../environments/environment";
import { EditorActionsService } from "../editor-actions.service";
import { TutorAutoTriggerService } from "../tutor-auto-trigger.service";
import { TutorOverlayService } from "../tutor-overlay.service";
import { TutorSettingsService } from "../tutor-settings.service";

@Component({
  selector: "app-agent-chat",
  imports: [AngularSvgIconModule, FormsModule, MatButtonModule],
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

  /** Layout do HUD flutuante (cartão em baixo) — compositor compacto. */
  @Input() immersiveLayout = false;

  @Input() cursorLineResolver?: () => number | undefined;

  @Input() cursorColumnResolver?: () => number | undefined;

  @Input() astSummaryResolver?: () => string | undefined;

  @Input() dataFlowContextResolver?: () => string | undefined;

  readonly baseUrlConfigured = Boolean(environment.agentApiBaseUrl?.trim());

  readonly scrollArea = viewChild<ElementRef<HTMLElement>>("scrollArea");

  readonly threadEnd = viewChild<ElementRef<HTMLElement>>("threadEnd");

  readonly draftInput = viewChild<ElementRef<HTMLTextAreaElement>>("draftInput");

  private readonly ngZone = inject(NgZone);

  private readonly injector = inject(Injector);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly editorActionsService = inject(EditorActionsService);

  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);

  private readonly tutorSettings = inject(TutorSettingsService);

  private readonly tutorOverlay = inject(TutorOverlayService);

  private readonly destroyRef = inject(DestroyRef);

  /** Tokens SSE acumulados até o próximo frame (evita NgZone/CD por caractere). */
  private streamingTokenBuffer = "";

  /** `requestAnimationFrame` pendente para aplicar `streamingTokenBuffer`. */
  private streamingTokenFlushRaf: number | null = null;

  draft = "";
  error: string | null = null;

  /** Resposta em andamento via SSE (`/help/stream`). */
  streamingAssistant = false;
  streamingText = "";

  private history: TutorHistoryItem[] = [];

  /** Conversa anterior arquivada após o tutor sinalizar problema resolvido (reabrir opcional). */
  lastArchivedThread: TutorHistoryItem[] | null = null;

  get thread(): TutorHistoryItem[] {
    return this.history;
  }

  get hasHistory(): boolean {
    return this.history.length > 0;
  }

  get canReopenArchived(): boolean {
    return (this.lastArchivedThread?.length ?? 0) > 0;
  }

  constructor() {
    this.tutorAutoTrigger.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(msg => {
      void this.sendWithText(msg);
    });
  }

  /** Foco no compositor (ex.: ao abrir o overlay). */
  focusComposer(): void {
    queueMicrotask(() => {
      const el = this.draftInput()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  reopenArchivedConversation(): void {
    if (!this.lastArchivedThread?.length) {
      return;
    }
    this.history = [...this.lastArchivedThread];
    this.lastArchivedThread = null;
    this.error = null;
    this.scrollThreadToEnd();
    this.cdr.markForCheck();
  }

  dismissArchivedHint(): void {
    this.lastArchivedThread = null;
    this.cdr.markForCheck();
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

  /** Altura auto do compositor imersivo (até ~8rem). */
  onHudComposerInput(event: Event): void {
    const ta = event.target as HTMLTextAreaElement;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || !this.baseUrlConfigured || this.streamingAssistant) {
      return;
    }
    this.draft = "";
    this.resetHudComposerHeight();
    await this.sendWithText(text);
  }

  private resetHudComposerHeight(): void {
    queueMicrotask(() => {
      const el = this.draftInput()?.nativeElement;
      if (!el) {
        return;
      }
      el.style.height = "auto";
    });
  }

  private async sendWithText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !this.baseUrlConfigured || this.streamingAssistant) {
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
      this.tutorOverlay.undim();
      this.history.push({ role: "user", content: trimmed });
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
          hintLevel: 1,
          studentName: this.tutorSettings.studentName() ?? undefined,
          cursorLine: this.cursorLineResolver?.(),
          cursorColumn: this.cursorColumnResolver?.(),
          astSummary: this.astSummaryResolver?.(),
          dataFlowContext: this.dataFlowContextResolver?.(),
        },
        {
          onToken: delta => {
            this.streamingTokenBuffer += delta;
            this.scheduleStreamingTokenFlush();
          },
          // Ações do editor são enfileiradas no EditorActionsService (rAF + NgZone) para não bloquear
          // o thread principal durante o SSE — evita competir com o worker de transpilação.
          onAction: action => {
            this.editorActionsService.dispatch(action);
          },
          onDone: (payload?: TutorStreamDonePayload) => {
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
              if (payload?.tutorMeta?.suggestedConversationEnd === true) {
                this.lastArchivedThread = [...this.history];
                this.history = [];
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
          if (this.history.length > 0 && this.history[this.history.length - 1]?.role === "user") {
            this.history.pop();
          }
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
    this.lastArchivedThread = null;
    this.error = null;
    this.streamingAssistant = false;
    this.streamingText = "";
    this.draft = "";
    this.resetHudComposerHeight();
    this.editorActionsService.clearTutorDecorations();
  }
}
