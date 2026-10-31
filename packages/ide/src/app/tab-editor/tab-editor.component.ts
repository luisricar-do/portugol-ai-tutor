import { DialogRef } from "@angular/cdk/dialog";
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from "@angular/cdk/menu";
import { ConnectedPosition } from "@angular/cdk/overlay";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MonacoEditorModule } from "@materia-ui/ngx-monaco-editor";
import { summarizeErrorClasses } from "@luisricar-do/agent";
import type { IPortugolCodeDiagnostic } from "@luisricar-do/antlr";
import { PortugolDiagnosticSeverity } from "@luisricar-do/antlr";
import { PortugolExecutor, PortugolMessage, PortugolWebWorkersRunner } from "@luisricar-do/runner";
import { CreateHotToastRef, HotToastService } from "@ngxpert/hot-toast";
import { AngularSplitModule, SplitGutterInteractionEvent } from "angular-split";
import { AngularSvgIconModule } from "angular-svg-icon";
import { saveAs } from "file-saver";
import { GoogleAnalyticsService, NgxGoogleAnalyticsModule } from "ngx-google-analytics";
import { EMPTY, Subscription, debounceTime, fromEventPattern, startWith, switchMap } from "rxjs";
import { environment } from "../../environments/environment";
import { GraphicsRenderer, IGraphicsRendererComponent } from "../../renderer";
import { settings } from "../../settings";
import { IExtendedWindowApi } from "../../types";
import { DialogRendererComponent, RendererDialogResult } from "../dialog-renderer/dialog-renderer.component";
import { EditorActionsService } from "../editor-actions.service";
import { ResponsiveService } from "../responsive.service";
import { SettingsService } from "../settings.service";
import { ShareService } from "../share.service";
import { atalhoDoEvento } from "../shared/atalhos";
import { DialogService } from "../shared/dialog.service";
import { focusAfterRender } from "../shared/focus";
import { moveRovingFocus } from "../shared/roving-focus";
import { TooltipDirective } from "../shared/tooltip.directive";
import { ThemeService } from "../theme.service";
import { TutorAutoTriggerService } from "../tutor-auto-trigger.service";
import { TutorChatSessionService } from "../tutor-chat-session.service";
import { TutorCompileTriggerService } from "../tutor-compile-trigger.service";
import { TutorEditorContextService, type TutorEditorContextHandle } from "../tutor-editor-context.service";
import { buildGlyphClickMessage, lineHasClickableTutorGlyph } from "../tutor-glyph-click.util";
import { TutorHudLayoutService } from "../tutor-hud-layout.service";
import { TutorImmersionService } from "../tutor-immersion.service";
import { TutorInterceptorService } from "../tutor-interceptor.service";
import { TutorOverlayService } from "../tutor-overlay.service";
import { TutorProactivityService } from "../tutor-proactivity.service";
import { TutorRealtimeValidatorService } from "../tutor-realtime-validator.service";
import { TutorStudySessionService } from "../tutor-study-session.service";
import { TutorTelemetryService } from "../tutor-telemetry.service";
import { WorkerService } from "../worker.service";
import { WorkspaceService } from "../workspace.service";

export type ProblemSeverity = "error" | "warning" | "info";

/**
 * Um erro, aviso ou informação do código, na forma que a lista de problemas e
 * a barra de status mostram.
 */
export interface Problem {
  severity: ProblemSeverity;
  message: string;
  line: number;
  column: number;
}

const SEVERITIES: Record<PortugolDiagnosticSeverity, ProblemSeverity> = {
  [PortugolDiagnosticSeverity.Error]: "error",
  [PortugolDiagnosticSeverity.Warning]: "warning",
  [PortugolDiagnosticSeverity.Information]: "info",
};

type PanelView = "output" | "problems";

/**
 * Os diagnósticos que barram a execução: os de sintaxe e os semânticos de severidade erro. É o
 * mesmo critério do `PortugolExecutor`. Avisos e informações (que o verificador passou a emitir)
 * ficam fora do que a tutora recebe como "erro do compilador" e da telemetria.
 */
function blockingErrors(
  diagnostics: readonly IPortugolCodeDiagnostic[],
  parseErrors: readonly IPortugolCodeDiagnostic[],
) {
  return [
    ...parseErrors,
    ...diagnostics.filter(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error),
  ];
}

function semanticErrors(diagnostics: readonly IPortugolCodeDiagnostic[]) {
  return diagnostics.filter(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error);
}

export type EditorOrigin = "editor" | "atalho";

@Component({
  selector: "app-tab-editor",
  imports: [
    AngularSplitModule,
    AngularSvgIconModule,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    FormsModule,
    MonacoEditorModule,
    NgxGoogleAnalyticsModule,
    TooltipDirective,
  ],
  templateUrl: "./tab-editor.component.html",
  styleUrl: "./tab-editor.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
  host: {
    "(document:keydown)": "onShortcut($event)",
  },
})
export class TabEditorComponent implements OnInit, OnDestroy {
  private gaService = inject(GoogleAnalyticsService);
  private toast = inject(HotToastService);
  private worker = inject(WorkerService);
  private shareService = inject(ShareService);
  private themeService = inject(ThemeService);
  private settingsService = inject(SettingsService);
  private dialog = inject(DialogService);
  private injector = inject(Injector);
  private responsive = inject(ResponsiveService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly studySession = inject(TutorStudySessionService);
  private workspace = inject(WorkspaceService);
  private editorActions = inject(EditorActionsService);
  private tutorEditorContext = inject(TutorEditorContextService);
  readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorHudLayout = inject(TutorHudLayoutService);
  readonly immersion = inject(TutorImmersionService);
  private readonly tutorInterceptor = inject(TutorInterceptorService);
  private readonly tutorProactivity = inject(TutorProactivityService);
  private readonly tutorRealtimeValidator = inject(TutorRealtimeValidatorService);
  private readonly tutorAutoTrigger = inject(TutorAutoTriggerService);
  private readonly tutorCompileTrigger = inject(TutorCompileTriggerService);
  private readonly tutorChatSession = inject(TutorChatSessionService);
  private readonly telemetry = inject(TutorTelemetryService);

  /**
   *  * Controla o botão Compartilhar; desligado na build de coleta.
   */
  readonly shareEnabled = environment.enableShare;

  /**
   * Na sessão de pesquisa somem abrir arquivo, salvar e exemplos: a tarefa vem pronta na aba.
   */
  readonly simplifiedUi = this.studySession.simplifiedUi;

  /**
   *  * Início da execução corrente, para medir a duração no evento `run`.
   */
  private runStartedAt: number | undefined;

  private glyphMouseDownDisposable?: monaco.IDisposable;
  private editSignal?: monaco.IDisposable;

  private _code$?: Subscription;
  private _stdOut$?: Subscription;
  private _events$?: Subscription;
  private _theme$?: Subscription;
  private _settings$?: Subscription;

  /**
   *  *  * A aba que este editor mostra; o conteúdo dela vive no estado da aplicação.
   */
  readonly tabId = input.required<string>();

  private readonly title = computed(() => this.workspace.titleOf(this.tabId()));

  /**
   * Esta aba de código é a que está em foco. Todas as abas ficam montadas: os
   * atalhos e a saída só valem para a aba em foco, e não para uma escondida.
   */
  readonly isActive = computed(() => this.workspace.activeTabId() === this.tabId());

  /**
   * Cópia local do código, que é o que o Monaco edita. O estado é a fonte da
   * verdade, mas reenviar cada tecla de volta para o editor recriaria o
   * conteúdo e jogaria o cursor para o início, então só escrevemos para fora.
   */
  code = "";

  /**
   *  *  * Se a execução atual terminou com erro, para o `execution_finish`
   */
  private runFailed = false;

  readonly help = output<EditorOrigin>();
  readonly settings = output();
  /**
   *  *  * Ctrl+O no editor: quem abre o arquivo é a janela, numa aba nova.
   */
  readonly openFile = output<EditorOrigin>();
  readonly examples = output();
  readonly newTab = output();
  readonly closeTab = output();

  /**
   *  *  * O menu "Salvar como" abre ao lado da barra de atividades.
   */
  readonly menuPositions: ConnectedPosition[] = [
    { originX: "end", originY: "top", overlayX: "start", overlayY: "top", offsetX: 4 },
    { originX: "end", originY: "bottom", overlayX: "start", overlayY: "bottom", offsetX: 4 },
  ];

  private readonly shareToastTemplate =
    viewChild.required<TemplateRef<{ data: { url: string } }>>("shareToastTemplate");

  readonly editorStage = viewChild<ElementRef<HTMLElement>>("editorStage");
  readonly flowSvg = viewChild<ElementRef<SVGSVGElement>>("flowSvg");

  /**
   *  *  * Erros, avisos e informações do código, da checagem mais recente.
   */
  readonly problems = signal<Problem[]>([]);

  /**
   *  *  * Posição do cursor no código, para a barra de status.
   */
  readonly cursor = signal({ line: 1, column: 1 });

  readonly panelView = signal<PanelView>("output");

  readonly problemIcons: Record<ProblemSeverity, string> = {
    error: "assets/mdi/close-circle-outline.svg",
    warning: "assets/mdi/alert-outline.svg",
    info: "assets/mdi/information-outline.svg",
  };

  readonly severityLabels: Record<ProblemSeverity, string> = {
    error: "Erro",
    warning: "Aviso",
    info: "Informação",
  };

  /**
   * Várias abas de código ficam abertas ao mesmo tempo: os `id`s usados por
   * `aria-controls` e `aria-labelledby` levam o da aba.
   */
  readonly ids = computed(() => {
    const id = this.tabId();

    return {
      outputTab: `painel-saida-aba-${id}`,
      outputPanel: `painel-saida-${id}`,
      problemsTab: `painel-problemas-aba-${id}`,
      problemsPanel: `painel-problemas-${id}`,
    };
  });

  transpiling = false;
  executor = new PortugolExecutor(PortugolWebWorkersRunner);

  graphicsRenderer = new GraphicsRenderer(this.executor);
  graphicsRendererModal: DialogRef<RendererDialogResult, DialogRendererComponent> | null = null;

  codeEditor?: monaco.editor.IStandaloneCodeEditor;

  // As cores dos pares são uma opção do modelo de texto, e o Monaco só repassa
  // ao modelo as chaves registradas na configuração: `bracketPairColorization`
  // não é uma delas, só `bracketPairColorization.enabled`.
  codeEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions & {
    "bracketPairColorization.enabled"?: boolean;
  } = {
    theme: "portugol-dark",
    language: "portugol",
    tabCompletion: "on",
    // Com a detecção, um arquivo já indentado ignoraria o tamanho da tabulação
    // escolhido nas configurações.
    detectIndentation: false,
    // Margem dos glifos da tutora (o "?" clicável na linha do erro).
    glyphMargin: true,
  };

  stdOutEditor?: monaco.editor.IStandaloneCodeEditor;
  private stdOutScrollPending = false;

  private readonly split = viewChild.required("split", { read: ElementRef<HTMLElement> });

  /**
   *  *  * Altura do cabeçalho do painel: é o que fica visível com ele recolhido.
   */
  // Mesma altura de `--pws-tab-height` (`.panel-header`), que o SCSS usa.
  readonly panelHeaderHeight = 35;

  /**
   *  *  * Altura do painel, em px. Começa recolhido e abre ao executar.
   */
  outputSize = this.panelHeaderHeight;

  /**
   * A última altura aberta que o usuário escolheu, para voltar a ela ao abrir
   * de novo.
   */
  private lastOpenOutputSize: number | null = null;

  /**
   * Em telas de toque, o teclado virtual não manda para o editor da saída
   * teclas que dê para ler (no Android, quase todas chegam como
   * "Unidentified"), e acentos e o corretor nem passam por elas. Lá, a entrada
   * do `leia` vai por um campo de texto comum.
   */
  readonly coarsePointer = this.responsive.coarsePointer;
  private readonly isBelowSm = this.responsive.isBelowSm;

  programInput = "";

  private readonly programInputField = viewChild<ElementRef<HTMLInputElement>>("programInputField");

  /**
   * A saída está na tela: a aba é a que está em foco, o painel está aberto e
   * mostra a saída, não a lista de problemas.
   */
  private outputVisible() {
    return this.isActive() && !this.outputCollapsed && this.panelView() === "output";
  }

  get outputCollapsed() {
    return this.outputSize <= this.panelHeaderHeight + 1;
  }

  outputAutoScroll = true;

  /**
   * O Monaco liga por padrão a fixação do bloco no topo e o recolher blocos, que
   * tratariam as linhas recuadas da saída como blocos de código. Fica num campo à
   * parte porque os tipos do `monaco` do ngx-monaco-editor são mais antigos que o
   * Monaco em uso e não conhecem o `stickyScroll`.
   */
  private readonly saidaSemBlocos = { stickyScroll: { enabled: false }, folding: false };

  stdOutEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: "portugol-dark",
    lineNumbers: "off",
    readOnly: true,
    minimap: { enabled: false },
    wordWrap: "on",
    language: "plaintext",
    // Na saída não se edita: a faixa da linha do cursor só pareceria uma caixa
    // vazia em volta da primeira linha.
    renderLineHighlight: "none",
    ...this.saidaSemBlocos,
    // Sem `tabSize`: no Monaco ele vale para todos os editores da página, e um
    // valor aqui sobrescreveria o das configurações no editor de código.
    guides: { indentation: false },
  };

  generatedCodeEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    ...this.stdOutEditorOptions,
    language: "swift",
    guides: { indentation: true },
  };

  sharing = false;

  hasSaveFilePickerSupport = "showSaveFilePicker" in window;

  private lastAstSummary = "";

  /**
   *  * Linhas que tinham erro na última passagem do worker (para ✔️ ao corrigir).
   */
  private lastCompilerErrorLines = new Set<number>();

  /**
   *  * Último lote de erros do compilador (reaplica marcadores quando ADA foca linha).
   */
  private lastCompilerErrors: IPortugolCodeDiagnostic[] = [];

  /**
   *  * Último lote completo de diagnósticos (erros, avisos e informações), para reaplicar.
   */
  private lastDiagnostics: IPortugolCodeDiagnostic[] = [];

  private readonly tutorContextHandle: TutorEditorContextHandle = {
    getEditorCode: () => this.code,
    getEditorCodeSnapshot: () => this.tutorEditorCodeSnapshot(),
    getCompilerErrors: () => this.tutorCompilerErrorsResolver(),
    getCursorLine: () => this.codeEditor?.getPosition()?.lineNumber,
    getCursorColumn: () => this.codeEditor?.getPosition()?.column,
    getAstSummary: () => (this.lastAstSummary.length > 0 ? this.lastAstSummary : undefined),
    getDataFlowContext: () => {
      const pending = this.immersion.pendingBrokenVar();
      const conns = this.immersion.dataFlowConnections();
      if (!pending && conns.length === 0) {
        return;
      }
      const parts: string[] = [];
      if (pending) {
        parts.push(`variável em atenção no fluxo: ${pending}`);
      }
      if (conns.length > 0) {
        parts.push(
          `ligações: ${conns
            .map(c => `L${c.fromLine}(${c.fromVar})→L${c.toLine}(${c.toVar})[${c.status}]`)
            .join("; ")}`,
        );
      }
      return parts.join(" · ").slice(0, 2000);
    },
    getCompilerErrorLines: () => this.getCompilerErrorLineNumbers(),
    getTabKey: () => this.tabId(),
  };

  /**
   *  * Código atual do buffer do Monaco para o tutor (o ngModel pode não estar sincronizado a cada tecla).
   */
  readonly tutorEditorCodeSnapshot = (): string => this.codeEditor?.getModel()?.getValue() ?? this.code;

  private formatCompilerError(error: IPortugolCodeDiagnostic): string {
    return `Linha ${error.startLine}, coluna ${error.startCol + 1}: ${error.message}`;
  }

  /**
   *  * Linhas 1-based com erro do compilador (alinhado ao payload `compilerErrorLines`).
   */
  private getCompilerErrorLineNumbers(): number[] {
    const lines = new Set(this.lastCompilerErrors.map(error => error.startLine));
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted exige lib ES2023; o spread já cria a cópia.
    return [...lines].sort((a, b) => a - b);
  }

  /**
   *  * Primeira linha com erro do compilador (scroll / corda ao abrir o HUD).
   */
  private firstCompilerMarkerLine(): number | undefined {
    return this.getCompilerErrorLineNumbers().at(0);
  }

  private getCompilerMarkerMessageForLine(line: number): string | undefined {
    return this.lastCompilerErrors.find(error => error.startLine === line)?.message;
  }

  /**
   *  * Clique no ? da margem: abre HUD, foca linha e envia pedido de ajuda ao tutor.
   */
  private openTutorFromGlyphClick(line: number): void {
    if (!this.isActive()) {
      return;
    }
    this.gaService.event("editor_glyph_open_tutor", "Editor", `Linha ${line}`);
    const msg = buildGlyphClickMessage(line, this.getCompilerMarkerMessageForLine(line));
    this.tutorOverlay.show({ focusLine: line });
    this.tutorAutoTrigger.emitUserMessage(msg);
  }

  private attachTutorGlyphClickHandler(editor: monaco.editor.IStandaloneCodeEditor): void {
    this.disposeTutorGlyphClickHandler();
    this.glyphMouseDownDisposable = editor.onMouseDown(e => {
      if (!this.isActive() || e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        return;
      }
      const line = e.target.position?.lineNumber;
      if (!line) {
        return;
      }
      const decos = editor.getLineDecorations(line);
      if (!lineHasClickableTutorGlyph(decos)) {
        return;
      }
      e.event.preventDefault();
      e.event.stopPropagation();
      this.openTutorFromGlyphClick(line);
    });
  }

  private disposeTutorGlyphClickHandler(): void {
    this.glyphMouseDownDisposable?.dispose();
    this.glyphMouseDownDisposable = undefined;
  }

  /**
   *  * Expõe linha-alvo ao alternar o HUD com ⌘⇧A / Ctrl+Shift+A (prioriza erro do compilador).
   */
  private tutorToggleFromEditor(): void {
    const focus = this.firstCompilerMarkerLine();
    if (focus === undefined) {
      this.tutorOverlay.toggle();
    } else {
      this.tutorOverlay.toggle({ focusLine: focus });
    }
  }

  /**
   * Botão da barra de atividades: sempre abre ou reativa o HUD (não usa
   * {@link TutorOverlayService.toggle}, para não fechar o tutor por engano).
   */
  openTutorHud(ev?: Event): void {
    ev?.stopPropagation();
    ev?.preventDefault();
    const focus = this.firstCompilerMarkerLine();
    if (focus === undefined) {
      this.tutorOverlay.show();
    } else {
      this.tutorOverlay.show({ focusLine: focus });
    }
  }

  /**
   *  * Posiciona a linha na zona útil acima do HUD (~25% inferior).
   */
  private scrollEditorLineForHud(lineNumber: number): void {
    const ed = this.codeEditor;
    if (!ed) {
      return;
    }
    const model = ed.getModel();
    if (!model) {
      return;
    }
    const ln = Math.min(Math.max(Math.trunc(lineNumber), 1), model.getLineCount());
    ed.revealLineInCenter(ln, monaco.editor.ScrollType.Smooth);
    requestAnimationFrame(() => {
      const layout = ed.getLayoutInfo();
      const pos = ed.getScrolledVisiblePosition({ lineNumber: ln, column: 1 });
      if (!layout || !pos) {
        this.scheduleFlowSvgLayout();
        return;
      }
      const lineCenterPx = pos.top + pos.height / 2;
      const hudReserve = layout.height * 0.45;
      const targetY = (layout.height - hudReserve) * 0.42;
      const delta = lineCenterPx - targetY;
      ed.setScrollTop(ed.getScrollTop() + delta);
      this.scheduleFlowSvgLayout();
    });
  }

  /**
   *  * Erros do compilador/analisador alinhados ao código atual (mesmo fluxo que o worker do editor).
   */
  tutorCompilerErrorsResolver = async (): Promise<string[]> => {
    const code = this.codeEditor?.getModel()?.getValue() ?? this.code;
    try {
      const { diagnostics, parseErrors } = await this.worker.checkCode(code);
      return blockingErrors(diagnostics, parseErrors).map(error => this.formatCompilerError(error));
    } catch {
      return this.lastCompilerErrors.map(error => this.formatCompilerError(error));
    }
  };

  /**
   * Com "Começar com o painel recolhido" desligado, o painel abre em 30% da
   * altura. Uma aba restaurada em segundo plano tem altura zero até aparecer,
   * então a conta espera a primeira vez que ela fica visível.
   */
  private firstLayout?: ResizeObserver;

  private openPanelOnFirstLayout() {
    if (this.settingsService.get(settings.outputStartCollapsed)) {
      return;
    }

    const element = this.split().nativeElement;

    this.firstLayout = new ResizeObserver(() => {
      if (element.clientHeight > 0) {
        this.firstLayout?.disconnect();
        this.expandOutput();
      }
    });

    this.firstLayout.observe(element);
  }

  constructor() {
    // O `split` só existe depois da primeira renderização.
    afterNextRender(() => {
      this.openPanelOnFirstLayout();
    });

    // A aba em foco é a que fala com a tutora: registra o contexto do editor e as ações.
    effect(() => {
      const active = this.isActive();
      untracked(() => {
        if (!active) {
          this.immersion.clearImmersion();
        }
        this.syncActiveEditorAndTutorContext();
      });
    });

    effect(() => {
      const list = this.immersion.dataFlowConnections();
      if (list.length === 0) {
        return;
      }
      this.scheduleFlowSvgLayout();
    });

    effect(() => {
      this.immersion.setGhostLinesMuted(this.tutorOverlay.isDimmed());
    });

    effect(() => {
      if (!this.isActive()) {
        return;
      }
      const open = this.tutorOverlay.isOpen();
      if (!open) {
        this.immersion.setHudLinkLine(null);
        return;
      }
      afterNextRender(
        () => {
          if (!this.isActive()) {
            return;
          }
          const pending = this.tutorOverlay.takePendingFocusLine();
          const line = pending ?? this.firstCompilerMarkerLine();
          if (line === undefined) {
            this.immersion.setHudLinkLine(null);
          } else {
            this.scrollEditorLineForHud(line);
            this.nudgeHudAwayFromEditorLine(line);
            this.immersion.setHudLinkLine(line);
          }
          this.scheduleFlowSvgLayout();
        },
        { injector: this.injector },
      );
    });

    effect(() => {
      this.tutorHudLayout.panelViewport();
      if (!this.isActive()) {
        return;
      }
      this.scheduleFlowSvgLayout();
    });

    // Na fase de captura, antes do `cdkMenuTrigger` do "Salvar como": nele, as
    // setas para cima e para baixo abririam o menu enquanto o foco itinerante
    // vai para o botão vizinho.
    this.host.nativeElement.addEventListener(
      "keydown",
      event => {
        this.onKeydown(event);
      },
      { capture: true },
    );
  }

  ngOnInit() {
    // O estado já entrega a aba pronta, inclusive o esqueleto de um programa novo.
    this.code = this.workspace.contentsOf(this.tabId());

    this._stdOut$ = this.executor.stdOut$.subscribe(() => {
      if (this.outputAutoScroll) {
        this.stdOutEditorCursorEnd();
      }
    });

    // Mesmo sem rolar sozinha, a saída vai para o fim quando o programa espera
    // uma entrada: é com o foco nela que o que se digita chega ao `leia`.
    this._stdOut$.add(
      this.executor.waitingForInput$.subscribe(waiting => {
        if (waiting) {
          this.showPanel("output");

          this.stdOutEditorCursorEnd();

          if (this.coarsePointer() && this.isActive()) {
            // O campo só existe depois da próxima renderização.
            focusAfterRender(this.injector, () => this.programInputField()?.nativeElement);
          }
        }
      }),
    );

    this._events$ = this.executor.events.subscribe({
      next: event => {
        switch (event.type) {
          case "finish": {
            // Como a execução terminou e quanto durou, em segundos (o tempo inclui a espera
            // pelo que a pessoa digita)
            const outcome = event.stopped ? "parado" : this.runFailed ? "erro" : "ok";

            // O teto de saída do executor parou um programa que não terminava (laço infinito).
            this.logRunEnd(event.outputLimit ? "output_limit" : "finished");

            // Depois de um erro de execução o runner também termina com `finish`: a tentativa
            // já foi registrada como falha no caso "error".
            if (!this.runFailed) {
              this.tutorChatSession.recordExecutionFinished(false, this.isActive());
            }

            // O `value` vai nas opções: o `event` do ngx-google-analytics descarta o 0
            this.gaService.event("execution_finish", "Execução", outcome, undefined, undefined, {
              value: Math.round(event.time / 1000),
            });

            const rendererModal = this.graphicsRendererModal;

            if (rendererModal) {
              this.graphicsRendererModal = null;
              rendererModal.close();
            }

            break;
          }

          case "error": {
            this.runFailed = true;
            this.gaService.event("execution_error", "Execução", this.errorLabel(event.error.message));
            this.logRunEnd("runtime_error");
            this.tutorInterceptor.onExecutionFailed(this.isActive(), event.error.message);
            this.tutorChatSession.recordExecutionFinished(true, this.isActive());
            break;
          }

          case "parseError": {
            // O código do Portugol Studio do primeiro erro; erros de sintaxe não têm código
            this.gaService.event(
              "execution_compile_error",
              "Execução",
              event.errors[0]?.code ?? "sintaxe",
              event.errors.length,
            );

            break;
          }

          case "message": {
            this.handlePortugolMessage(event.message).catch(console.error);
            break;
          }

          default: {
            break;
          }
        }
      },

      error: error => {
        // Só o tipo do erro: a mensagem pode trazer partes do código
        this.gaService.event(
          "execution_runner_error",
          "Execução",
          error instanceof Error ? error.name : "desconhecido",
        );

        console.error(error);
      },
    });

    this._theme$ = this.themeService.theme$.subscribe(theme => {
      this.codeEditorOptions = { ...this.codeEditorOptions, theme: `portugol-${theme}` };
      this.stdOutEditorOptions = { ...this.stdOutEditorOptions, theme: `portugol-${theme}` };
      this.generatedCodeEditorOptions = { ...this.generatedCodeEditorOptions, theme: `portugol-${theme}` };
    });

    this._settings$ = this.settingsService.editorOptions().subscribe(options => {
      this.codeEditorOptions = {
        ...this.codeEditorOptions,
        ...options,
        // No celular, o minimapa cobriria o fim das linhas de código.
        minimap: { enabled: options.minimap?.enabled === true && !this.isBelowSm() },
      };

      this.generatedCodeEditorOptions = {
        ...this.generatedCodeEditorOptions,
        fontSize: options.fontSize,
        wordWrap: options.wordWrap,
      };
    });

    this._settings$.add(
      this.settingsService.outputFontSize().subscribe(fontSize => {
        this.stdOutEditorOptions = { ...this.stdOutEditorOptions, fontSize };
      }),
    );

    // A quebra de linha da saída é uma configuração à parte da do editor de
    // código: desenhos e tabelas feitos com texto só ficam certos sem ela.
    this._settings$.add(
      this.settingsService.observe(settings.outputWordWrap).subscribe(wordWrap => {
        this.stdOutEditorOptions = { ...this.stdOutEditorOptions, wordWrap: wordWrap ? "on" : "off" };
      }),
    );

    this._settings$.add(
      this.settingsService.observe(settings.outputShowExecutionTime).subscribe(show => {
        this.executor.showExecutionTime = show;
      }),
    );

    this._settings$.add(
      this.settingsService.observe(settings.outputClearOnRun).subscribe(clear => {
        this.executor.clearStdOutOnRun = clear;
      }),
    );

    this._settings$.add(
      this.settingsService.observe(settings.outputAutoScroll).subscribe(autoScroll => {
        this.outputAutoScroll = autoScroll;
      }),
    );

    this.graphicsRenderer.addEventListener("create", event => {
      const component = this.openRendererModal();

      if (component) {
        event.component = component;
      }
    });
  }

  private flowSvgLayoutRaf: number | null = null;

  private scheduleFlowSvgLayout(): void {
    if (this.flowSvgLayoutRaf !== null) {
      cancelAnimationFrame(this.flowSvgLayoutRaf);
    }
    this.flowSvgLayoutRaf = requestAnimationFrame(() => {
      this.flowSvgLayoutRaf = null;
      this.updateFlowSvgPaths();
    });
  }

  private updateFlowSvgPaths(): void {
    if (!this.isActive()) {
      return;
    }
    const svg = this.flowSvg()?.nativeElement;
    const stage = this.editorStage()?.nativeElement;
    const ed = this.codeEditor;
    if (!svg || !stage || !ed) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    svg.setAttribute("width", String(rect.width));
    svg.setAttribute("height", String(rect.height));
    svg.replaceChildren();
    const w = rect.width;
    const conns = this.immersion.dataFlowConnections();
    for (const c of conns) {
      const p1 = ed.getScrolledVisiblePosition({ lineNumber: c.fromLine, column: 1 });
      const p2 = ed.getScrolledVisiblePosition({ lineNumber: c.toLine, column: 1 });
      if (!p1 || !p2) {
        continue;
      }
      const stageRect = stage.getBoundingClientRect();
      const editorDom = ed.getDomNode();
      const editorRect = editorDom?.getBoundingClientRect();
      if (!editorRect) {
        continue;
      }
      const x1 = editorRect.left - stageRect.left + p1.left + 48;
      const y1 = editorRect.top - stageRect.top + p1.top + p1.height / 2;
      const x2 = editorRect.left - stageRect.left + p2.left + 48;
      const y2 = editorRect.top - stageRect.top + p2.top + p2.height / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const midX = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", c.status === "ok" ? "rgb(34 197 94 / 0.85)" : "rgb(245 158 11 / 0.9)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-dasharray", c.status === "ok" ? "6 4" : "4 6");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute(
        "class",
        c.status === "ok" ? "tutor-flow-path tutor-flow-path--ok" : "tutor-flow-path tutor-flow-path--broken",
      );
      svg.append(path);
    }
    const hudLine = this.immersion.hudLinkLine();
    const hudPanel = this.tutorHudLayout.panelViewport();
    if (hudLine !== null && hudPanel) {
      const pT = ed.getScrolledVisiblePosition({ lineNumber: hudLine, column: 1 });
      const editorDom2 = ed.getDomNode();
      const editorRect2 = editorDom2?.getBoundingClientRect();
      if (pT && editorRect2) {
        // Origem junto ao canto inferior do HUD (próximo do FAB “cérebro”), não ao topo.
        const startX = hudPanel.left + hudPanel.width - 28 - rect.left;
        const startY = hudPanel.top + hudPanel.height - rect.top;
        const endX = editorRect2.left - rect.left + pT.left + 48;
        const endY = editorRect2.top - rect.top + pT.top + pT.height / 2;
        const pathHud = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const midY = (startY + endY) / 2;
        pathHud.setAttribute("d", `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`);
        pathHud.setAttribute("fill", "none");
        pathHud.setAttribute("stroke", "rgb(34 211 238 / 0.95)");
        pathHud.setAttribute("stroke-width", "2");
        pathHud.setAttribute("stroke-dasharray", "8 6");
        pathHud.setAttribute("stroke-linecap", "round");
        pathHud.setAttribute("class", "tutor-flow-path tutor-hud-cord");
        svg.append(pathHud);
      }
    }

    if (conns.length > 0) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(w - 8));
      label.setAttribute("y", "14");
      label.setAttribute("text-anchor", "end");
      label.setAttribute("fill", "var(--pws-fg-muted, #94a3b8)");
      label.setAttribute("font-size", "10");
      label.textContent = "Fluxo de dados (tutor)";
      svg.append(label);
    }
  }

  ngOnDestroy() {
    if (this.flowSvgLayoutRaf !== null) {
      cancelAnimationFrame(this.flowSvgLayoutRaf);
      this.flowSvgLayoutRaf = null;
    }
    this.tutorEditorContext.unregister(this.tutorContextHandle);
    this.disposeTutorGlyphClickHandler();
    this.editSignal?.dispose();
    if (this.isActive()) {
      this.editorActions.setEditor(null);
      this.editorActions.setRefreshCompilerMarkers(null);
      this.editorActions.setRunCode(null);
      this.editorActions.setStopCode(null);
    }
    this.firstLayout?.disconnect();
    this.executor.stop();
    this.worker.abortTranspilation();
    this._code$?.unsubscribe();
    this._events$?.unsubscribe();
    this._stdOut$?.unsubscribe();
    this._theme$?.unsubscribe();
    this._settings$?.unsubscribe();
  }

  /**
   * A mensagem do erro sem nada do programa, para os erros iguais serem contados juntos e
   * nada do que foi digitado sair do navegador: textos entre aspas (menos os nomes de
   * tipos, como 'cadeia'), valores entre parênteses, o nome depois de dois-pontos no fim
   * (como em "Função não declarada: calcular") e números. O Analytics guarda até 100
   * caracteres.
   */
  private errorLabel(message: string) {
    const typeNames = new Set(["inteiro", "real", "cadeia", "caracter", "logico", "vazio"]);

    return message
      .replaceAll(/'([^']*)'/g, (quoted, content: string) => (typeNames.has(content) ? quoted : "'…'"))
      .replaceAll(/"[^"]*"/g, '"…"')
      .replaceAll(/\([^)]*\)/g, "(…)")
      .replace(/:\s*\S+$/, ": …")
      .replaceAll(/\d+(?:[.,]\d+)?/g, "N")
      .trim()
      .slice(0, 100);
  }

  async runCode(origin: EditorOrigin) {
    if (this.transpiling) {
      return;
    }

    this.gaService.event("editor_start_execution", "Editor", origin);
    this.telemetry.log({ type: "run", phase: "start" });
    this.runStartedAt = Date.now();
    this.runFailed = false;
    this.showPanel("output");
    // O que ficou no campo de toque de uma execução interrompida não pode
    // virar a resposta do próximo `leia`.
    this.programInput = "";

    this.transpiling = true;

    // Usa o snapshot direto do Monaco para não depender do sincronismo do ngModel.
    const code = this.codeEditor?.getModel()?.getValue() ?? this.code;
    let result;

    try {
      result = await this.worker.transpileCode(code);
    } catch (error) {
      console.error(error, { transpile: true });

      alert(
        "Ocorreu um erro ao transpilar o código, possivelmente o seu navegador não suporta Web Workers. Por favor, tente novamente em outro navegador. Caso o erro persista, acesse https://github.com/dgadelha/Portugol-Webstudio/issues/new/choose",
      );

      alert(error);
    } finally {
      this.transpiling = false;
    }

    if (result) {
      // A checagem ao vivo é debounced: quem edita e roda em menos de 500ms veria as marcas
      // do código anterior. Estas vêm do mesmo `checkCode` que decidiu se ia executar.
      this.setEditorDiagnostics(result.diagnostics.concat(result.parseErrors));

      // Com erro de compilação o programa não executa: a lista de Problemas, que leva até cada
      // erro, é mais útil que a saída. O critério é o mesmo do executor.
      const temErro =
        result.parseErrors.length > 0 ||
        result.diagnostics.some(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error);

      if (temErro) {
        this.showPanel("problems");

        // A tutora reage ao erro de compilação ao executar (não a cada tecla).
        const errors = blockingErrors(result.diagnostics, result.parseErrors);
        this.logCheckResult(semanticErrors(result.diagnostics), result.parseErrors, "compile_on_run");
        this.logRunEnd("compile_error");
        this.tutorCompileTrigger.onRunWithCompileErrors(errors, this.isActive());
        this.tutorChatSession.recordExecutionFinished(true, this.isActive());
      }

      this.executor.runTranspiled(result);
    }
  }

  /**
   *  *  * Pelo botão Parar, ou ao fechar a janela de gráficos (pelo botão dela ou com Esc).
   */
  stopCode(origin: "editor" | "janela_graficos") {
    this.gaService.event("editor_stop_execution", "Editor", origin);
    // Interrupção manual é o sinal mais próximo de laço infinito que a IDE tem;
    // a classificação final é feita na análise, com a duração da execução.
    this.logRunEnd("stopped");
    this.executor.stop();

    if (this.transpiling) {
      this.worker.abortTranspilation();
      this.transpiling = false;
    }

    this.stdOutEditorCursorEnd();
  }

  /**
   * Os atalhos da aba de código quando o foco não está no editor, que tem os
   * mesmos atalhos (em `onEditorInit`) e consome o evento antes daqui.
   */
  onShortcut(event: KeyboardEvent) {
    if (!this.isActive()) {
      return;
    }

    switch (atalhoDoEvento(event)) {
      case "f1": {
        event.preventDefault();
        this.openHelp("atalho");
        break;
      }

      case "ctrl+s": {
        event.preventDefault();
        this.saveFromEditor("atalho");
        break;
      }

      case "ctrl+o": {
        event.preventDefault();
        this.openFile.emit("atalho");
        break;
      }

      case "ctrl+enter": {
        event.preventDefault();

        if (this.canRun()) {
          void this.runCode("atalho");
        }

        break;
      }

      default:
    }
  }

  async handlePortugolMessage(message: PortugolMessage) {
    if (message.type.startsWith("graphics.")) {
      await this.graphicsRenderer.handleRendererMessage(message);
    }
  }

  openRendererModal(): IGraphicsRendererComponent | null {
    this.gaService.event("editor_open_renderer", "Editor", "Abrir modal de renderização");
    const titleId = `janela-graficos-titulo-${this.tabId()}`;

    const modal = this.dialog.open<RendererDialogResult, unknown, DialogRendererComponent>(DialogRendererComponent, {
      ariaLabelledBy: titleId,
      data: { titleId },
      panelClass: "pws-renderer-dialog",
      modeless: true,
    });

    this.graphicsRendererModal = modal;

    modal.closed.subscribe(result => {
      this.graphicsRenderer.destroy();

      // Só a janela atual: depois de um `encerrar_modo_grafico`, o programa pode abrir outra.
      if (this.graphicsRendererModal === modal) {
        this.graphicsRendererModal = null;

        // Sem resultado é o Esc, que também encerra o programa.
        if (result?.stopProgram !== false) {
          this.stopCode("janela_graficos");
        }
      }
    });

    return modal.componentInstance;
  }

  onCodeChange(contents: string) {
    this.code = contents;
    this.workspace.setContents(this.tabId(), contents);
  }

  /**
   * ISO-8859-1 (o que o Portugol Studio abre) tem um byte por caractere, igual aos primeiros
   * 256 pontos do Unicode. O que não cabe nele vira `?`.
   */
  private encodeLatin1(text: string) {
    return Uint8Array.from(text, char => {
      const code = char.codePointAt(0)!;

      return code <= 0xff ? code : 0x3f;
    });
  }

  private prepareFile(as: "text" | "binary", compat = false) {
    const blob = (() => {
      if (compat) {
        return new Blob([this.encodeLatin1(this.code)], {
          type: `${as === "binary" ? "application/octet-stream" : "text/plain"}; charset=ISO-8859-1`,
        });
      }

      return new Blob([this.code], {
        type: as === "binary" ? "application/octet-stream" : "text/plain",
      });
    })();

    let fileName = this.title();

    if (!fileName.endsWith(".por")) {
      fileName += ".por";
    }

    return { blob, fileName };
  }

  /**
   * O Salvar do editor, pelo botão ou pelo Ctrl+S. O "Baixar" do Salvar como também usa o
   * `saveFile`, mas tem o próprio evento.
   */
  saveFromEditor(origin: EditorOrigin) {
    this.gaService.event("editor_save_file", "Editor", origin);
    this.saveFile();
  }

  saveFile(compat = false) {
    const { blob, fileName } = this.prepareFile("binary", compat);

    saveAs(blob, fileName, { autoBom: false });
  }

  saveFileManual(as: "text" | "binary") {
    const { blob, fileName } = this.prepareFile(as);
    const file = new File([blob], fileName, { type: blob.type });

    window.open(URL.createObjectURL(file), "_blank");
  }

  async saveFileWithPicker() {
    const extendedWindowApi = window as IExtendedWindowApi;

    if (!extendedWindowApi.showSaveFilePicker) {
      return;
    }

    const { blob, fileName } = this.prepareFile("binary");

    try {
      const fileHandle = await extendedWindowApi.showSaveFilePicker({
        types: [
          {
            description: "Arquivo Portugol",
            accept: {
              "application/octet-stream": [".por"],
            },
          },
        ],
        excludeAcceptAllOption: true,
        suggestedName: fileName,
      });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      this.gaService.event("editor_save_as_file_picker_result", "Editor", "ok");
      this.toast.success("Arquivo salvo com sucesso!", { duration: 3000 });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.gaService.event("editor_save_as_file_picker_result", "Editor", "cancelado");
        return;
      }

      this.gaService.event("editor_save_as_file_picker_result", "Editor", "erro");
      console.error(error);

      this.toast.error("Ocorreu um erro ao salvar o arquivo!", { duration: 5000 });
    }
  }

  onStdOutEditorInit(editor: monaco.editor.IStandaloneCodeEditor) {
    this.initShortcuts(editor);
    this.stdOutEditor = editor;

    editor.onKeyDown(e => {
      if (!this.executor.waitingForInput) {
        return;
      }

      if (e.code === "Enter" || e.browserEvent.key === "Enter") {
        this.executor.stdIn.next("\r");
      } else if (e.code === "Backspace") {
        this.executor.stdIn.next("\b");
      } else if (e.browserEvent.key.length === 1) {
        this.executor.stdIn.next(e.browserEvent.key);
      }
    });
  }

  /**
   * O divisor guarda o tamanho arrastado só para ele: o valor fica espelhado
   * aqui para recolher e abrir partirem do tamanho certo.
   */
  onSplitDragEnd({ sizes }: SplitGutterInteractionEvent) {
    const size = sizes[1];

    if (typeof size !== "number") {
      return;
    }

    this.outputSize = size;
    this.gaService.event("split_drag", "Divisores", "saida", undefined, undefined, { value: Math.round(size) });

    if (!this.outputCollapsed) {
      this.lastOpenOutputSize = size;
    }
  }

  /**
   * O código gerado fica escondido à direita do editor, atrás de um divisor de 1px: quem o
   * arrasta abre o JavaScript gerado. O valor é a largura do código gerado, em %.
   */
  onGeneratedCodeDragEnd({ sizes }: SplitGutterInteractionEvent) {
    const size = sizes[1];

    if (typeof size === "number") {
      // 0 = o código gerado foi fechado de novo
      this.gaService.event("split_drag", "Divisores", "codigo_gerado", undefined, undefined, {
        value: Math.round(size),
      });
    }
  }

  expandOutput() {
    if (this.outputCollapsed) {
      this.outputSize = this.lastOpenOutputSize ?? Math.round(this.split().nativeElement.clientHeight * 0.3);
    }
  }

  /**
   * Mostra a saída ou a lista de problemas, abrindo o painel se estiver
   * recolhido.
   */
  showPanel(view: PanelView) {
    this.panelView.set(view);
    this.expandOutput();
  }

  /**
   * As abas "Saída" e "Problemas" do painel. O `showPanel` também é chamado ao executar,
   * e só o clique conta.
   */
  selectPanelTab(view: PanelView) {
    this.gaService.event("output_panel_tab", "Saída", view);
    this.showPanel(view);
  }

  /**
   *  *  * Pela barra de status: abre a lista de problemas e leva o foco até ela.
   */
  showProblems() {
    this.gaService.event("output_panel_tab", "Barra de status", "problems_barra_status");
    this.showPanel("problems");

    focusAfterRender(this.injector, () => this.panelTab(this.ids().problemsTab));
  }

  /**
   * As setas trocam entre Saída e Problemas, como no padrão de abas da
   * WAI-ARIA.
   */
  onPanelTabsKeydown(event: KeyboardEvent) {
    const tablist = (event.currentTarget as HTMLElement).closest<HTMLElement>("[role=tablist]");

    if (tablist) {
      moveRovingFocus(event, tablist, "[role=tab]", "horizontal")?.click();
    }
  }

  /**
   *  *  * Uma das abas do painel (Saída ou Problemas) desta aba de código.
   */
  private panelTab(id: string) {
    return this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
  }

  canRun() {
    return !this.transpiling && !this.executor.running;
  }

  canStop() {
    return this.transpiling || this.executor.running;
  }

  private onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const activityBar = target.closest<HTMLElement>(".activity-bar");

    // Setas, Home e End percorrem os botões da barra de atividades, como numa
    // barra de ferramentas: só um deles fica na ordem do Tab.
    if (activityBar && target.matches(".activity-button")) {
      if (moveRovingFocus(event, activityBar, ".activity-button", "vertical")) {
        event.stopPropagation();
      }
    }
  }

  toggleOutput() {
    this.gaService.event("output_toggle", "Saída", this.outputCollapsed ? "mostrar" : "recolher");

    if (this.outputCollapsed) {
      this.expandOutput();
    } else {
      this.outputSize = this.panelHeaderHeight;
    }
  }

  /**
   * Manda a linha do campo como se cada letra tivesse sido digitada na saída,
   * seguida do Enter.
   */
  sendProgramInput() {
    this.gaService.event("touch_input_submit", "Saída", "Campo de entrada");

    for (const char of this.programInput) {
      this.executor.stdIn.next(char);
    }

    this.executor.stdIn.next("\r");
    this.programInput = "";
  }

  clearOutput() {
    this.gaService.event("output_clear", "Saída", "Limpar saída");
    this.executor.stdOut = "";

    // Com a saída vazia, o botão fica desativado e perderia o foco: ele vai
    // para a aba "Saída", logo ao lado.
    this.panelTab(this.ids().outputTab)?.focus();
  }

  stdOutEditorCursorEnd() {
    // Um `escreva` em laço chama isto milhares de vezes por segundo: uma rolagem pendente basta,
    // e ela lê o tamanho da saída quando roda, não quando foi pedida.
    if (!this.stdOutEditor || this.stdOutScrollPending) {
      return;
    }

    const editor = this.stdOutEditor;
    const model = editor.getModel();

    if (model) {
      this.stdOutScrollPending = true;

      // TODO: Find a better way to do this
      setTimeout(() => {
        this.stdOutScrollPending = false;

        if (model.isDisposed()) {
          return;
        }

        editor.setPosition({
          lineNumber: model.getLineCount(),
          column: model.getLineMaxColumn(model.getLineCount()),
        });

        editor.setScrollPosition({
          scrollLeft: 0,
          scrollTop: editor.getScrollHeight(),
        });
      }, 1);

      // Em telas de toque, o foco fica no campo de entrada: no editor, ele só
      // abriria o teclado virtual à toa. Com a saída escondida (painel
      // recolhido, lista de problemas ou outra aba em foco), focá-la tiraria o
      // foco do que a pessoa estiver usando.
      if (!this.coarsePointer() && this.outputVisible()) {
        editor.focus();
      }
    }
  }

  /**
   * `CtrlCmd` é o Cmd no Mac; o `WinCtrl` acrescenta o Ctrl de verdade, que é o
   * atalho mostrado nas dicas (no Mac, o Ctrl+O do Monaco inseriria uma linha).
   */
  initShortcuts(editor: monaco.editor.IStandaloneCodeEditor) {
    editor.addAction({
      id: "runCode",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter],
      label: "Executar código",
      run: () => {
        if (this.canRun()) {
          void this.runCode("atalho");
        }
      },
    });

    editor.addAction({
      id: "saveFile",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyS],
      label: "Salvar arquivo",
      run: () => {
        this.saveFromEditor("atalho");
      },
    });

    editor.addAction({
      id: "openFile",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyO],
      label: "Abrir arquivo",
      run: () => {
        this.openFile.emit("atalho");
      },
    });

    editor.addAction({
      id: "openHelp",
      keybindings: [monaco.KeyCode.F1],
      label: "Ajuda",
      run: () => {
        this.openHelp("atalho");
      },
    });

    // Os atalhos de abas do IDE também valem com o cursor no código
    editor.addAction({
      id: "newTab",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyN],
      label: "Nova aba de código",
      run: () => {
        this.newTab.emit();
      },
    });

    editor.addAction({
      id: "closeTab",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyW],
      label: "Fechar aba",
      run: () => {
        this.closeTab.emit();
      },
    });

    // ⌘⇧A / Ctrl+Shift+A: com o foco no editor, o Monaco captura o atalho antes do documento.
    editor.addAction({
      id: "toggleTutorAda",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA],
      label: "Alternar tutora ADA",
      run: () => {
        this.tutorToggleFromEditor();
      },
    });
  }

  onEditorInit(editor: monaco.editor.IStandaloneCodeEditor) {
    this.codeEditor = editor;
    this.syncActiveEditorAndTutorContext();
    this.initShortcuts(editor);
    this.attachTutorGlyphClickHandler(editor);

    editor.onDidScrollChange(() => {
      this.scheduleFlowSvgLayout();
    });

    // Sinal de edição (δ da métrica de atrito): registado no evento em si, antes do debounce
    // e mesmo com a checagem ao vivo desligada, para preservar a ordem face aos turnos de chat.
    this.editSignal?.dispose();
    this.editSignal = editor.onDidChangeModelContent(() => {
      if (this.tutorOverlay.isOpen()) {
        this.tutorOverlay.dim();
      }
      this.logCodeEdit();
    });

    // Uma aba recém-aberta pede o foco antes de o Monaco existir.
    if (this.workspace.consumeFocusRequest(this.tabId())) {
      editor.focus();
    }

    editor.onDidChangeCursorPosition(({ position }) => {
      this.cursor.set({ line: position.lineNumber, column: position.column });
    });

    this._code$?.unsubscribe();

    // Sem a checagem ao vivo, os erros só aparecem ao executar. Ligada, ela confere o código
    // na hora, sem esperar a próxima tecla: o editor pode nascer já com o código da aba (ao
    // recarregar a página), e aí nenhuma mudança de conteúdo chega a disparar a primeira
    // checagem. Se o código ainda chegar depois, o `debounceTime` junta as duas numa só.
    this._code$ = this.settingsService
      .observe(settings.editorLiveDiagnostics)
      .pipe(
        switchMap(live => {
          if (!live) {
            this.setEditorDiagnostics([]);
            return EMPTY;
          }

          const changes = fromEventPattern(
            handler => editor.onDidChangeModelContent(handler),
            (_handler, listener: monaco.IDisposable) => {
              listener.dispose();
            },
          );

          // Dentro do `switchMap`, uma checagem em andamento ao desligar é
          // descartada, e não marca erros depois da limpeza.
          return changes.pipe(
            startWith(null),
            debounceTime(500),
            switchMap(async () => this.worker.checkCode(this.codeEditor?.getModel()?.getValue() ?? this.code)),
          );
        }),
      )
      .subscribe({
        next: result => {
          this.setEditorDiagnostics(result.diagnostics.concat(result.parseErrors));

          const errors = blockingErrors(result.diagnostics, result.parseErrors);
          this.lastAstSummary = `erros:${errors.length};parse_ok:${errors.length === 0}`;
          this.logCheckResult(semanticErrors(result.diagnostics), result.parseErrors);
          this.tutorRealtimeValidator.onErrorsUpdated(errors.map(error => this.formatCompilerError(error)));
          this.tutorProactivity.resetWatch(errors.length > 0);
          this.scheduleFlowSvgLayout();
        },
        error(err) {
          console.error(err);
        },
      });
  }

  /**
   * Registra a edição de código. O texto **não** é enviado — só o tamanho e um
   * resumo, o que basta para o sinal de edição e mantém o dado minimizado.
   */
  private logCodeEdit(): void {
    if (!this.isActive()) {
      return;
    }
    const code = this.codeEditor?.getModel()?.getValue() ?? this.code;
    this.telemetry.log({
      type: "code_edit",
      codeLength: code.length,
      codeLines: code.length === 0 ? 0 : code.split("\n").length,
    });
  }

  /**
   * Resultado da verificação estática, com a classe de falha do protocolo. Só os erros: os
   * avisos e as informações do verificador não entram na contagem.
   */
  private logCheckResult(
    errors: readonly IPortugolCodeDiagnostic[],
    parseErrors: readonly IPortugolCodeDiagnostic[],
    trigger: "check" | "compile_on_run" = "check",
  ): void {
    if (!this.isActive()) {
      return;
    }
    const summary = summarizeErrorClasses(errors, parseErrors);
    this.telemetry.log({
      type: "compile",
      trigger,
      errorCount: summary.errorCount,
      errorClass: summary.errorClass,
      errorClassCounts: summary.errorClassCounts,
      errorLines: [...errors, ...parseErrors].map(error => error.startLine).slice(0, 20),
    });
  }

  private logRunEnd(outcome: "finished" | "runtime_error" | "compile_error" | "stopped" | "output_limit"): void {
    if (!this.isActive() || this.runStartedAt === undefined) {
      return;
    }
    const durationMs = Math.max(0, Date.now() - this.runStartedAt);
    this.runStartedAt = undefined;
    this.telemetry.log({ type: "run", phase: "end", outcome, durationMs });
  }

  private syncActiveEditorAndTutorContext(): void {
    if (this.isActive()) {
      this.tutorEditorContext.register(this.tutorContextHandle);
      if (this.codeEditor) {
        this.editorActions.setEditor(this.codeEditor);
        this.editorActions.setRefreshCompilerMarkers(() => {
          if (this.lastDiagnostics.length > 0) {
            this.setEditorDiagnostics([...this.lastDiagnostics]);
          }
        });
        this.editorActions.setRunCode(() => {
          if (this.canRun()) {
            void this.runCode("editor");
          }
        });
        this.editorActions.setStopCode(() => {
          this.stopCode("editor");
        });
      }
      this.scheduleFlowSvgLayout();
    } else {
      this.tutorEditorContext.unregister(this.tutorContextHandle);
    }
  }

  /**
   *  * Remove destaques e comentários inline do tutor no Monaco (não limpa o chat).
   */
  clearTutorEditorDecorations(): void {
    this.editorActions.clearTutorDecorations();
    this.gaService.event("editor_tutor_clear_decorations", "Editor", "Limpar destaques do tutor");
  }

  private nudgeHudAwayFromEditorLine(line: number): void {
    const ed = this.codeEditor;
    if (!ed) {
      return;
    }
    const pos = ed.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
    const dom = ed.getDomNode();
    if (!pos || !dom) {
      return;
    }
    const rect = dom.getBoundingClientRect();
    const lineHeight = ed.getOption(monaco.editor.EditorOption.lineHeight);
    this.tutorHudLayout.nudgeHudAwayFromLine(rect.top + pos.top, lineHeight);
  }

  /**
   * A aba da Ajuda registra o próprio evento (`help_tab_open` ou `help_tab_select`), com
   * esta origem.
   */
  openHelp(origin: EditorOrigin) {
    this.help.emit(origin);
  }

  openSettings() {
    this.gaService.event("open_settings_dialog", "Editor", "editor");
    this.settings.emit();
  }

  async shareFile() {
    if (!this.shareEnabled || !this.code) {
      return;
    }

    this.sharing = true;

    const result = await this.shareService.share(this.code);

    if (result.ok) {
      this.toast.show(this.shareToastTemplate(), {
        data: { url: result.value },
        duration: 30_000,
        dismissible: true,
        // O link precisa ser lido e copiado: o aviso só some ao ser fechado,
        // senão sumiria enquanto alguém chega nele pelo teclado.
        autoClose: false,
        ariaLive: "polite",
      });

      this.gaService.event("share_code_success", "Editor", "editor");
    } else {
      this.toast.error(
        result.reason === "offline"
          ? "Sem internet para compartilhar o código. Conecte-se e tente de novo."
          : "Ocorreu um erro ao compartilhar o arquivo. Tente novamente mais tarde.",
        { duration: 5000 },
      );

      this.gaService.event("share_code_error", "Editor", result.reason);
    }

    setTimeout(() => {
      this.sharing = false;
    }, 1000);
  }

  /**
   * A área de transferência pode recusar (sem permissão, ou fora de um contexto seguro): o
   * aviso com o link continua aberto para copiar à mão.
   */
  async copyShareUrl(toastRef: CreateHotToastRef<{ url: string }>) {
    try {
      await navigator.clipboard.writeText(toastRef.data.url);
    } catch (error) {
      console.error(error);
      this.gaService.event("share_copy_link", "Editor", "erro");
      this.toast.error("Não foi possível copiar o link. Selecione o link e copie.", { duration: 5000 });
      return;
    }

    this.gaService.event("share_copy_link", "Editor", "ok");
    toastRef.close();
    this.toast.success("Link copiado.", { duration: 3000 });
  }

  setEditorDiagnostics(diagnostics: IPortugolCodeDiagnostic[]) {
    this.lastDiagnostics = diagnostics;
    const model = this.codeEditor?.getModel();

    // Fork: o tutor marca uma linha primária de erro (o glifo clicável) e atenua as demais.
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === PortugolDiagnosticSeverity.Error);
    this.lastCompilerErrors = errors;

    const nextLineSet = new Set(errors.map(error => error.startLine));
    // `Set#difference` não existe nos navegadores antigos que o IDE ainda atende (ver o `sort` abaixo).
    // eslint-disable-next-line unicorn/prefer-set-methods
    const clearedLines = [...this.lastCompilerErrorLines].filter(line => !nextLineSet.has(line));
    if (clearedLines.length > 0) {
      this.editorActions.flashResolvedCompilerLines(clearedLines);
    }
    this.lastCompilerErrorLines = nextLineSet;

    const primaryFromTutor = this.tutorHudLayout.getTutorPrimaryErrorLine();
    const primaryLine =
      primaryFromTutor != null && nextLineSet.has(primaryFromTutor)
        ? primaryFromTutor
        : errors.length > 0
          ? errors[0].startLine
          : null;

    this.editorActions.setCompilerIssueLines(primaryLine === null ? [...nextLineSet] : [primaryLine]);

    if (model) {
      const severityMap: Record<PortugolDiagnosticSeverity, monaco.MarkerSeverity> = {
        [PortugolDiagnosticSeverity.Error]: monaco.MarkerSeverity.Error,
        [PortugolDiagnosticSeverity.Warning]: monaco.MarkerSeverity.Warning,
        [PortugolDiagnosticSeverity.Information]: monaco.MarkerSeverity.Info,
      };

      monaco.editor.setModelMarkers(
        model,
        "owner",
        diagnostics.map(error => {
          return {
            startLineNumber: error.startLine,
            startColumn: this.editorColumn(model, error.startLine, error.startCol),
            endLineNumber: error.endLine,
            endColumn: this.editorColumn(model, error.endLine, error.endCol + 1),
            message: error.message,
            // Erros fora da linha primária viram dica: menos alarmantes (ver `.squiggly-hint`).
            severity:
              primaryLine !== null &&
              error.severity === PortugolDiagnosticSeverity.Error &&
              error.startLine !== primaryLine
                ? monaco.MarkerSeverity.Hint
                : (severityMap[error.severity] ?? monaco.MarkerSeverity.Error),
          };
        }),
      );
    }

    // A lista de problemas mostra os erros primeiro, na ordem do código.
    const order: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };

    this.problems.set(
      diagnostics
        .map<Problem>(diagnostic => {
          return {
            severity: SEVERITIES[diagnostic.severity] ?? "error",
            message: diagnostic.message,
            line: diagnostic.startLine,
            column: model
              ? this.editorColumn(model, diagnostic.startLine, diagnostic.startCol)
              : diagnostic.startCol + 1,
          };
        })
        // O Firefox 113 e o Chrome 96–101, que ainda aparecem no Sentry, não têm `toSorted`.
        // eslint-disable-next-line unicorn/no-array-sort -- o `map` acima já criou uma cópia
        .sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line || a.column - b.column),
    );
  }

  /**
   * A coluna (base 0) da análise conta pontos de código, como o ANTLR; o Monaco conta unidades
   * de UTF-16 (base 1). Sem a conversão, cada emoji antes na linha deslocava o marcador.
   */
  private editorColumn(model: monaco.editor.ITextModel, line: number, column: number) {
    if (line < 1 || line > model.getLineCount()) {
      return column + 1;
    }

    return Array.from(model.getLineContent(line)).slice(0, column).join("").length + 1;
  }

  /**
   *  *  * Leva o cursor até o problema e devolve o foco ao código.
   */
  revealProblem(problem: Problem) {
    this.gaService.event("problem_reveal", "Problemas", problem.severity);

    const editor = this.codeEditor;

    if (!editor) {
      return;
    }

    editor.setPosition({ lineNumber: problem.line, column: problem.column });
    editor.revealPositionInCenter({ lineNumber: problem.line, column: problem.column });
    editor.focus();
  }

  focusEditor() {
    this.codeEditor?.focus();
  }

  goToLine() {
    this.codeEditor?.focus();
    this.codeEditor?.trigger("barra-de-status", "editor.action.gotoLine", null);
  }
}
