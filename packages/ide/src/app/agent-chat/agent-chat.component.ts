import {
  afterNextRender,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  effect,
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
export class AgentChatComponent implements AfterViewInit {
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

  /** Linhas 1-based com erro de compilação no momento do pedido (payload `compilerErrorLines`). */
  @Input() compilerErrorLinesResolver?: () => number[];

  readonly baseUrlConfigured = Boolean(environment.agentApiBaseUrl?.trim());

  /** No modo HUD: só a última troca visível até expandir. */
  immersiveHistoryExpanded = false;

  private readonly hudPlaceholders = [
    "Entrada: Minha hipótese é…",
    "Entrada: Eu acho que o erro está ocorrendo porque…",
    "Entrada: Se eu mudar esta condição, então…",
    "Entrada: O que me parece estranho aqui é…",
  ];

  private immersivePlaceholderIndex = 0;

  /** Havia erros reportados desde que o overlay esteve aberto — para celebrar limpeza. */
  private compileErrorsWerePresent = false;

  private successCelebrationTriggered = false;

  private compileRecoveryInterval: ReturnType<typeof setInterval> | null = null;

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

  /** Opacidade por linha `.agent-chat__row` (modo imersivo), atualizada no scroll. */
  private rowOpacityValues: number[] = [];

  private layerOpacityReduceMotion = false;

  /** `requestAnimationFrame` para recalcular opacidades das mensagens. */
  private layerOpacityRaf: number | null = null;

  private threadScrollEl: HTMLElement | null = null;

  private readonly onThreadScroll = (): void => {
    this.scheduleLayerOpacityUpdate();
  };

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

  /** Histórico visível no HUD compacto (última interação). */
  visibleThreadForDisplay(): TutorHistoryItem[] {
    if (!this.immersiveLayout || this.immersiveHistoryExpanded) {
      return this.history;
    }
    const t = this.history;
    if (t.length <= 2) {
      return t;
    }
    let start = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i].role === "user") {
        start = i;
        break;
      }
    }
    return t.slice(start);
  }

  showImmersiveHistoryToggle(): boolean {
    return this.immersiveLayout && !this.immersiveHistoryExpanded && this.history.length > 2;
  }

  /** Usado pela barra «Mover» do overlay (botão Ver histórico). */
  expandImmersiveHudHistory(): void {
    if (!this.immersiveLayout) {
      return;
    }
    this.immersiveHistoryExpanded = true;
    this.scrollThreadToEnd();
    this.scheduleLayerOpacityUpdate();
    this.cdr.markForCheck();
  }

  /** Faixa de estado do HUD (PT), derivada do TutorOverlayService. */
  immersiveStateLabel(): string {
    switch (this.tutorOverlay.uiState()) {
      case "observer":
        return "A observar a sua edição";
      default:
        return "";
    }
  }

  immersiveMsgLabelsVisuallyHidden(): boolean {
    return this.immersiveLayout && !this.immersiveHistoryExpanded;
  }

  /** Destaque tipográfico na última resposta da tutora (HUD colapsado). */
  isHeroAssistantBubble(index: number): boolean {
    if (!this.immersiveLayout || this.immersiveHistoryExpanded || this.streamingAssistant) {
      return false;
    }
    const vis = this.visibleThreadForDisplay();
    if (vis.length === 0) {
      return false;
    }
    let lastAi = -1;
    for (let i = vis.length - 1; i >= 0; i--) {
      if (vis[i].role === "assistant") {
        lastAi = i;
        break;
      }
    }
    return lastAi === index;
  }

  get immersiveHudPlaceholder(): string {
    const lines = this.compilerErrorLinesResolver?.() ?? [];
    const firstLine = lines.length ? lines[0] : null;
    const errs = this.compilerErrorsSnapshot?.() ?? [];
    const ident = AgentChatComponent.extractIdentifierHint(errs[0]);
    const contextual =
      firstLine != null
        ? [
          `Eu percebi que na linha ${firstLine}…`,
          ident
            ? `Talvez se eu mudar ${ident} para…`
            : "Talvez se eu mudar a variável para…",
          `Entrada: na linha ${firstLine}, minha hipótese é…`,
          `Entrada: Se eu ajustar a linha ${firstLine}, então…`,
        ]
        : this.hudPlaceholders;
    const idx = this.immersivePlaceholderIndex % contextual.length;
    return contextual[idx] ?? this.hudPlaceholders[0];
  }

  /** FAB “pronto para submeter hipótese” quando há texto no rascunho. */
  hudSendReady(): boolean {
    return this.immersiveLayout && Boolean(this.draft.trim()) && !this.streamingAssistant;
  }

  private static extractIdentifierHint(errorMsg: string | undefined): string | null {
    if (!errorMsg?.trim()) {
      return null;
    }
    const quoted = errorMsg.match(/[`'"]([a-zA-Z_][\w]*)[`'"]/);
    if (quoted) {
      return quoted[1];
    }
    const named = errorMsg.match(/\b(identificador|variável|variavel|nome)\s+[`'"]([\w]+)[`'"]/i);
    if (named) {
      return named[2];
    }
    return null;
  }

  /** Compositor mais compacto (menos padding) quando o campo está vazio. */
  hudComposerSlim(): boolean {
    return this.immersiveLayout && !this.draft.trim();
  }

  onHudPlaceholderRotate(): void {
    this.immersivePlaceholderIndex++;
  }

  get hasHistory(): boolean {
    return this.history.length > 0;
  }

  get canReopenArchived(): boolean {
    return (this.lastArchivedThread?.length ?? 0) > 0;
  }

  constructor() {
    this.refreshLayerOpacityReduceMotion();
    this.tutorAutoTrigger.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(msg => {
      void this.sendWithText(msg);
    });
    effect(
      () => {
        if (!this.tutorOverlay.isOpen()) {
          this.compileErrorsWerePresent = false;
          this.successCelebrationTriggered = false;
          return;
        }
        if (!this.immersiveLayout) {
          return;
        }
        this.successCelebrationTriggered = false;
        const lines = this.compilerErrorLinesResolver?.() ?? [];
        this.compileErrorsWerePresent = lines.length > 0;
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => {
      this.detachThreadScrollListener();
      if (this.layerOpacityRaf !== null) {
        cancelAnimationFrame(this.layerOpacityRaf);
        this.layerOpacityRaf = null;
      }
      if (this.compileRecoveryInterval != null) {
        clearInterval(this.compileRecoveryInterval);
        this.compileRecoveryInterval = null;
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.immersiveLayout) {
      this.attachThreadScrollListener();
      this.scheduleLayerOpacityUpdate();
      this.compileRecoveryInterval = setInterval(() => {
        this.checkCompileErrorRecovery();
      }, 400);
    }
  }

  /**
   * Erros de compilação eliminados após haver erros com o HUD aberto: mensagem fixa + brilho verde + fechar.
   */
  private checkCompileErrorRecovery(): void {
    if (!this.immersiveLayout || !this.tutorOverlay.isOpen() || this.successCelebrationTriggered) {
      return;
    }
    if (this.streamingAssistant) {
      return;
    }
    const lines = this.compilerErrorLinesResolver?.() ?? [];
    if (lines.length > 0) {
      this.compileErrorsWerePresent = true;
      return;
    }
    if (this.compileErrorsWerePresent) {
      this.successCelebrationTriggered = true;
      this.triggerCompileFixedCelebration();
    }
  }

  private triggerCompileFixedCelebration(): void {
    this.ngZone.run(() => {
      this.history.push({
        role: "assistant",
        content:
          "Exato! Você percebeu como a condição de parada alterou o fluxo? Vamos seguir.",
      });
      this.scrollThreadToEnd();
      this.cdr.markForCheck();
      this.tutorOverlay.beginSuccessCelebration();
    });
  }

  /** Opacidade por índice de mensagem (e `thread.length` para a linha em streaming). */
  rowOpacityStyle(index: number): string | undefined {
    if (!this.immersiveLayout || this.layerOpacityReduceMotion) {
      return undefined;
    }
    if (!this.immersiveHistoryExpanded && this.history.length > 2) {
      return undefined;
    }
    const v = this.rowOpacityValues[index];
    return String(v ?? 1);
  }

  private refreshLayerOpacityReduceMotion(): void {
    this.layerOpacityReduceMotion =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private attachThreadScrollListener(): void {
    if (!this.immersiveLayout) {
      this.detachThreadScrollListener();
      return;
    }
    const el = this.scrollArea()?.nativeElement;
    if (!el || el === this.threadScrollEl) {
      return;
    }
    this.detachThreadScrollListener();
    this.threadScrollEl = el;
    el.addEventListener("scroll", this.onThreadScroll, { passive: true });
  }

  private detachThreadScrollListener(): void {
    if (this.threadScrollEl) {
      this.threadScrollEl.removeEventListener("scroll", this.onThreadScroll);
      this.threadScrollEl = null;
    }
  }

  private scheduleLayerOpacityUpdate(): void {
    if (!this.immersiveLayout || !this.baseUrlConfigured) {
      return;
    }
    if (this.layerOpacityRaf !== null) {
      return;
    }
    this.layerOpacityRaf = requestAnimationFrame(() => {
      this.layerOpacityRaf = null;
      this.updateMessageLayerOpacities();
    });
  }

  private updateMessageLayerOpacities(): void {
    if (!this.immersiveLayout) {
      this.rowOpacityValues = [];
      return;
    }
    this.refreshLayerOpacityReduceMotion();
    if (this.layerOpacityReduceMotion) {
      this.rowOpacityValues = [];
      this.cdr.markForCheck();
      return;
    }
    const scrollEl = this.scrollArea()?.nativeElement;
    if (!scrollEl) {
      return;
    }
    const rows = scrollEl.querySelectorAll<HTMLElement>(".agent-chat__row");
    const scrollRect = scrollEl.getBoundingClientRect();
    const visibleBottom = scrollRect.bottom;
    const fullBandPx = 280;
    const minOpacity = 0.35;
    const fadeRangePx = 420;
    const next: number[] = [];
    rows.forEach(row => {
      const rowRect = row.getBoundingClientRect();
      const d = visibleBottom - rowRect.bottom;
      let opacity: number;
      if (d <= fullBandPx) {
        opacity = 1;
      } else {
        const extra = d - fullBandPx;
        const t = Math.min(1, extra / fadeRangePx);
        opacity = 1 - t * (1 - minOpacity);
      }
      next.push(opacity);
    });
    this.rowOpacityValues = next;
    this.cdr.markForCheck();
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
    this.scheduleLayerOpacityUpdate();
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
            this.attachThreadScrollListener();
            this.scheduleLayerOpacityUpdate();
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

  private compilerLinesPayload(): number[] | undefined {
    const raw = this.compilerErrorLinesResolver?.();
    if (!raw?.length) {
      return undefined;
    }
    const lines = [...new Set(raw.map(n => Math.trunc(Number(n))).filter(n => Number.isFinite(n) && n >= 1))];
    return lines.length > 0 ? lines.sort((a, b) => a - b) : undefined;
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

  /** Altura auto do compositor imersivo (até ~8rem). `scrollHeight` pode ser subdimensionado sem mínimo explícito. */
  onHudComposerInput(event: Event): void {
    const ta = event.target as HTMLTextAreaElement;
    const maxPx = 192;
    const minPx = 40;
    ta.style.height = "auto";
    const next = Math.min(Math.max(ta.scrollHeight, minPx), maxPx);
    ta.style.height = `${next}px`;
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
      el.style.removeProperty("height");
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
          compilerErrorLines: this.compilerLinesPayload(),
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
    this.immersiveHistoryExpanded = false;
    this.resetHudComposerHeight();
    this.editorActionsService.clearTutorDecorations();
    this.scheduleLayerOpacityUpdate();
  }
}
