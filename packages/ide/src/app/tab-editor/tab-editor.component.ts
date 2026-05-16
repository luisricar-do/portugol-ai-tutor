import {
  Component,
  ElementRef,
  Injector,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  TemplateRef,
  afterNextRender,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { PortugolCodeError } from "@luisricar-do/antlr";
import { PortugolExecutor, PortugolMessage, PortugolWebWorkersRunner } from "@luisricar-do/runner";
import { saveAs } from "file-saver";
import { encode } from "iconv-lite";
import { ShortcutInput } from "ng-keyboard-shortcuts";
import { GoogleAnalyticsService } from "ngx-google-analytics";
import { Subscription, combineLatest, debounceTime, fromEventPattern, switchMap, tap } from "rxjs";
import { GraphicsRenderer, IGraphicsRendererComponent } from "../../renderer";
import { IExtendedWindowApi } from "../../types";
import { DialogRendererComponent } from "../dialog-renderer/dialog-renderer.component";
import { EditorActionsService } from "../editor-actions.service";
import { FileService } from "../file.service";
import { SettingsService } from "../settings.service";
import { ShareService } from "../share.service";
import { ThemeService } from "../theme.service";
import { TutorEditorContextService, type TutorEditorContextHandle } from "../tutor-editor-context.service";
import { TutorHudLayoutService } from "../tutor-hud-layout.service";
import { TutorImmersionService } from "../tutor-immersion.service";
import { TutorInterceptorService } from "../tutor-interceptor.service";
import { TutorOverlayService } from "../tutor-overlay.service";
import { TutorProactivityService } from "../tutor-proactivity.service";
import { TutorRealtimeValidatorService } from "../tutor-realtime-validator.service";
import { WorkerService } from "../worker.service";

@Component({
  selector: "app-tab-editor",
  // eslint-disable-next-line @angular-eslint/prefer-standalone
  standalone: false,
  templateUrl: "./tab-editor.component.html",
  styleUrl: "./tab-editor.component.scss",
})
export class TabEditorComponent implements OnInit, OnDestroy, OnChanges {
  private _code$?: Subscription;
  private _stdOut$?: Subscription;
  private _events$?: Subscription;
  private _theme$?: Subscription;
  private _settings$?: Subscription;

  private gaService = inject(GoogleAnalyticsService);
  private snack = inject(MatSnackBar);
  private worker = inject(WorkerService);
  private fileService = inject(FileService);
  private shareService = inject(ShareService);
  private themeService = inject(ThemeService);
  private settingsService = inject(SettingsService);
  private dialog = inject(MatDialog);
  private editorActions = inject(EditorActionsService);
  private tutorEditorContext = inject(TutorEditorContextService);
  readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorHudLayout = inject(TutorHudLayoutService);
  private readonly injector = inject(Injector);
  readonly immersion = inject(TutorImmersionService);
  private readonly tutorInterceptor = inject(TutorInterceptorService);
  private readonly tutorProactivity = inject(TutorProactivityService);
  private readonly tutorRealtimeValidator = inject(TutorRealtimeValidatorService);

  @Input()
  title?: string;

  @Input()
  code?: string;

  /** Aba visível no grupo de separadores — regista contexto do tutor e editor ativo. */
  @Input()
  isActiveTab = false;

  /** Espelho reativo de {@link isActiveTab} para efeitos que dependem do HUD (apenas aba ativa consome scroll/corda). */
  private readonly isActiveTabSignal = signal(false);

  readonly titleChange = output<string>();
  readonly help = output();
  readonly settings = output();

  readonly shareSnackTemplate = viewChild.required<TemplateRef<{ data: { url: string } }>>("shareSnackTemplate");
  readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>("fileInput");
  readonly editorStage = viewChild<ElementRef<HTMLElement>>("editorStage");
  readonly flowSvg = viewChild<ElementRef<SVGSVGElement>>("flowSvg");

  transpiling = false;
  executor = new PortugolExecutor(PortugolWebWorkersRunner);

  graphicsRenderer = new GraphicsRenderer(this.executor);
  graphicsRendererModal: MatDialogRef<DialogRendererComponent> | null = null;

  codeEditor?: monaco.editor.IStandaloneCodeEditor;

  codeEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: "portugol-dark",
    language: "portugol",
    tabCompletion: "on",
    tabSize: 2,
    glyphMargin: true,
  };

  stdOutEditor?: monaco.editor.IStandaloneCodeEditor;

  stdOutEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    theme: "portugol-dark",
    lineNumbers: "off",
    readOnly: true,
    minimap: { enabled: false },
    wordWrap: "on",
    language: "plaintext",
    tabSize: 2,
  };

  generatedCodeEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    ...this.stdOutEditorOptions,
    language: "swift",
  };

  sharing = false;

  private lastAstSummary = "";

  /** Linhas que tinham erro na última passagem do worker (para ✔️ ao corrigir). */
  private lastCompilerErrorLines = new Set<number>();

  private readonly tutorContextHandle: TutorEditorContextHandle = {
    getEditorCode: () => this.code ?? "",
    getEditorCodeSnapshot: () => this.tutorEditorCodeSnapshot(),
    getCompilerErrors: () => this.tutorCompilerErrorsResolver(),
    getCursorLine: () => this.codeEditor?.getPosition()?.lineNumber,
    getCursorColumn: () => this.codeEditor?.getPosition()?.column,
    getAstSummary: () => (this.lastAstSummary.length > 0 ? this.lastAstSummary : undefined),
    getDataFlowContext: () => {
      const pending = this.immersion.pendingBrokenVar();
      const conns = this.immersion.dataFlowConnections();
      if (!pending && conns.length === 0) {
        return undefined;
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
  };

  /** Código atual do buffer do Monaco para o tutor (o ngModel pode não estar sincronizado a cada tecla). */
  readonly tutorEditorCodeSnapshot = (): string => this.codeEditor?.getModel()?.getValue() ?? this.code ?? "";

  private readMonacoCompilerErrorLines(): string[] {
    const model = this.codeEditor?.getModel();
    if (!model) {
      return [];
    }

    const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: "owner" });
    return markers.map(m => `Linha ${m.startLineNumber}, coluna ${m.startColumn}: ${m.message}`);
  }

  /** Linhas 1-based com marcador do owner (alinhado ao payload `compilerErrorLines`). */
  private getCompilerErrorLineNumbers(): number[] {
    const model = this.codeEditor?.getModel();
    if (!model) {
      return [];
    }
    const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: "owner" });
    const lines = new Set<number>();
    for (const m of markers) {
      lines.add(m.startLineNumber);
    }
    return [...lines].sort((a, b) => a - b);
  }

  /** Primeira linha com marcador do compilador (scroll / corda ao abrir o HUD). */
  private firstCompilerMarkerLine(): number | undefined {
    const lines = this.getCompilerErrorLineNumbers();
    return lines.length > 0 ? lines[0] : undefined;
  }

  /** Recolhe o terminal em baixo quando o HUD do tutor está aberto. */
  get tutorSplitEditorSize(): number {
    return this.tutorOverlay.isOpen() ? 100 : 80;
  }

  get tutorSplitTerminalSize(): number {
    return this.tutorOverlay.isOpen() ? 0 : 20;
  }

  /** Expõe linha-alvo ao alternar o HUD com ⌘⇧A / Ctrl+Shift+A (prioriza erro do compilador). */
  private tutorToggleFromEditor(): void {
    const focus = this.firstCompilerMarkerLine();
    if (focus !== undefined) {
      this.tutorOverlay.toggle({ focusLine: focus });
    } else {
      this.tutorOverlay.toggle();
    }
  }

  /**
   * Botão lateral: sempre abre ou reativa o HUD (não usa {@link TutorOverlayService.toggle},
   * para não fechar o tutor por engano e “devolver” o painel de saída como se fosse o terminal).
   */
  openTutorHud(ev?: Event): void {
    ev?.stopPropagation();
    ev?.preventDefault();
    const focus = this.firstCompilerMarkerLine();
    if (focus !== undefined) {
      this.tutorOverlay.show({ focusLine: focus });
    } else {
      this.tutorOverlay.show();
    }
  }

  /** Posiciona a linha na zona útil acima do HUD (~25% inferior). */
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
    ed.revealLineInCenter(ln, 0);
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

  /** Erros do compilador/analisador alinhados ao código atual (mesmo fluxo que o worker do editor). */
  tutorCompilerErrorsResolver = async (): Promise<string[]> => {
    const code = this.codeEditor?.getModel()?.getValue() ?? this.code ?? "";
    try {
      const { errors, parseErrors } = await this.worker.checkCode(code);
      return [...errors, ...parseErrors].map(e => `Linha ${e.startLine}, coluna ${e.startCol + 1}: ${e.message}`);
    } catch {
      return this.readMonacoCompilerErrorLines();
    }
  };

  hasSaveFilePickerSupport = "showSaveFilePicker" in window;

  shortcuts: ShortcutInput[] = [
    {
      key: "f1",
      preventDefault: true,
      command: this.openHelp.bind(this),
    },
    {
      key: "ctrl + s",
      preventDefault: true,
      command: () => {
        this.saveFile();
      },
    },
    {
      key: "ctrl + o",
      preventDefault: true,
      command: () => {
        this.fileInput().nativeElement.click();
      },
    },
    {
      key: "ctrl + enter",
      preventDefault: true,
      command: this.runCode.bind(this),
    },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["isActiveTab"]) {
      this.isActiveTabSignal.set(this.isActiveTab);
      if (!this.isActiveTab) {
        this.immersion.clearImmersion();
      }
      this.syncActiveEditorAndTutorContext();
    }
  }

  ngOnInit() {
    this.isActiveTabSignal.set(this.isActiveTab);
    this.code ||= `programa {\n  funcao inicio() {\n    \n  }\n}\n`;

    this._stdOut$ = this.executor.stdOut$.subscribe(() => {
      this.stdOutEditorCursorEnd();
    });

    this._events$ = this.executor.events.subscribe({
      next: event => {
        switch (event.type) {
          case "finish": {
            const rendererModal = this.graphicsRendererModal;

            if (rendererModal) {
              this.graphicsRendererModal = null;
              rendererModal.close();
            }

            break;
          }

          case "error": {
            this.gaService.event("execution_error", "Execução", "Erro em execução de código");
            this.tutorInterceptor.onExecutionFailed(this.isActiveTab);
            break;
          }

          case "parseError": {
            this.setEditorErrors(event.errors);
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
        this.gaService.event("execution_runner_error", "Execução", "Erro ao carregar o runner para rodar o código");

        console.error(error, { code: this.code });
      },
    });

    this._theme$ = this.themeService.theme$.subscribe(theme => {
      this.codeEditorOptions = { ...this.codeEditorOptions, theme: `portugol-${theme}` };
      this.stdOutEditorOptions = { ...this.stdOutEditorOptions, theme: `portugol-${theme}` };
      this.generatedCodeEditorOptions = { ...this.generatedCodeEditorOptions, theme: `portugol-${theme}` };
    });

    this._settings$ = combineLatest([
      this.settingsService.editorFontSize,
      this.settingsService.editorWordWrap,
    ]).subscribe(([fontSize, wordWrap]) => {
      this.codeEditorOptions = {
        ...this.codeEditorOptions,
        fontSize,
        wordWrap: wordWrap ? "on" : "off",
      };

      this.stdOutEditorOptions = {
        ...this.stdOutEditorOptions,
        fontSize,
        wordWrap: wordWrap ? "on" : "off",
      };

      this.generatedCodeEditorOptions = {
        ...this.generatedCodeEditorOptions,
        fontSize,
        wordWrap: wordWrap ? "on" : "off",
      };
    });

    this.graphicsRenderer.addEventListener("create", event => {
      const component = this.openRendererModal();

      if (component) {
        event.component = component;
      }
    });
  }

  constructor() {
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
      if (!this.isActiveTabSignal()) {
        return;
      }
      const open = this.tutorOverlay.isOpen();
      if (!open) {
        this.immersion.setHudLinkLine(null);
        return;
      }
      afterNextRender(
        () => {
          if (!this.isActiveTabSignal()) {
            return;
          }
          const pending = this.tutorOverlay.takePendingFocusLine();
          const line = pending ?? this.firstCompilerMarkerLine();
          if (line !== undefined) {
            this.scrollEditorLineForHud(line);
            this.immersion.setHudLinkLine(line);
          } else {
            this.immersion.setHudLinkLine(null);
          }
          this.scheduleFlowSvgLayout();
        },
        { injector: this.injector },
      );
    });

    effect(() => {
      this.tutorHudLayout.panelViewport();
      if (!this.isActiveTabSignal()) {
        return;
      }
      this.scheduleFlowSvgLayout();
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
    if (!this.isActiveTab) {
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
    svg.innerHTML = "";
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
      path.setAttribute(
        "stroke",
        c.status === "ok" ? "rgb(34 197 94 / 0.85)" : "rgb(245 158 11 / 0.9)",
      );
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-dasharray", c.status === "ok" ? "6 4" : "4 6");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute(
        "class",
        c.status === "ok" ? "tutor-flow-path tutor-flow-path--ok" : "tutor-flow-path tutor-flow-path--broken",
      );
      svg.appendChild(path);
    }
    const hudLine = this.immersion.hudLinkLine();
    const hudPanel = this.tutorHudLayout.panelViewport();
    if (hudLine !== null && hudPanel) {
      const pT = ed.getScrolledVisiblePosition({ lineNumber: hudLine, column: 1 });
      const editorDom2 = ed.getDomNode();
      const editorRect2 = editorDom2?.getBoundingClientRect();
      if (pT && editorRect2) {
        /* Origem junto ao canto inferior do HUD (próximo do FAB “cérebro”), não ao topo. */
        const startX = hudPanel.left + hudPanel.width - 28 - rect.left;
        const startY = hudPanel.top + hudPanel.height - rect.top;
        const endX = editorRect2.left - rect.left + pT.left + 48;
        const endY = editorRect2.top - rect.top + pT.top + pT.height / 2;
        const pathHud = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const midY = (startY + endY) / 2;
        pathHud.setAttribute(
          "d",
          `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`,
        );
        pathHud.setAttribute("fill", "none");
        pathHud.setAttribute("stroke", "rgb(34 211 238 / 0.95)");
        pathHud.setAttribute("stroke-width", "2");
        pathHud.setAttribute("stroke-dasharray", "8 6");
        pathHud.setAttribute("stroke-linecap", "round");
        pathHud.setAttribute("class", "tutor-flow-path tutor-hud-cord");
        svg.appendChild(pathHud);
      }
    }

    if (conns.length > 0) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(w - 8));
      label.setAttribute("y", "14");
      label.setAttribute("text-anchor", "end");
      label.setAttribute("fill", "var(--pws-text-300, #94a3b8)");
      label.setAttribute("font-size", "10");
      label.textContent = "Fluxo de dados (tutor)";
      svg.appendChild(label);
    }
  }

  ngOnDestroy() {
    if (this.flowSvgLayoutRaf !== null) {
      cancelAnimationFrame(this.flowSvgLayoutRaf);
      this.flowSvgLayoutRaf = null;
    }
    this.tutorEditorContext.unregister(this.tutorContextHandle);
    this.executor.stop();
    this.worker.abortTranspilation();
    this._code$?.unsubscribe();
    this._events$?.unsubscribe();
    this._stdOut$?.unsubscribe();
    this._theme$?.unsubscribe();
    this._settings$?.unsubscribe();
    this.editorActions.setEditor(null);
    this.editorActions.setRunCode(null);
    this.editorActions.setStopCode(null);
  }

  async runCode() {
    if (this.transpiling) {
      return;
    }

    this.gaService.event("editor_start_execution", "Editor", "Botão de Iniciar Execução");

    this.transpiling = true;

    // Usa snapshot direto do Monaco para evitar depender do sincronismo do ngModel.
    const code = this.codeEditor?.getModel()?.getValue() ?? this.code ?? "";
    this.code = code;
    let result;

    try {
      result = await this.worker.transpileCode(code);
    } catch (error) {
      console.error(error, { transpile: true, code });

      alert(
        "Ocorreu um erro ao transpilar o código, possivelmente o seu navegador não suporta Web Workers. Por favor, tente novamente em outro navegador. Caso o erro persista, acesse https://github.com/dgadelha/Portugol-Webstudio/issues/new/choose",
      );

      alert(error);
    } finally {
      this.transpiling = false;
    }

    if (result) {
      this.setEditorErrors([]);
      this.executor.runTranspiled({ ...result, code });
    }
  }

  stopCode() {
    this.gaService.event("editor_stop_execution", "Editor", "Botão de Parar Execução");
    this.executor.stop();

    if (this.transpiling) {
      this.worker.abortTranspilation();
      this.transpiling = false;
    }

    this.stdOutEditorCursorEnd();
  }

  async handlePortugolMessage(message: PortugolMessage) {
    if (message.type.startsWith("graphics.")) {
      await this.graphicsRenderer.handleRendererMessage(message);
    }
  }

  openRendererModal(): IGraphicsRendererComponent | null {
    this.gaService.event("editor_open_renderer", "Editor", "Abrir modal de renderização");
    this.graphicsRendererModal = this.dialog.open(DialogRendererComponent, {
      hasBackdrop: false,
      panelClass: "portugol-renderer-dialog",
    });

    this.graphicsRendererModal.afterClosed().subscribe(() => {
      this.graphicsRenderer.destroy();

      if (this.graphicsRendererModal !== null) {
        this.graphicsRendererModal = null;
        this.stopCode();
      }
    });

    return this.graphicsRendererModal.componentInstance;
  }

  async openFile(event: Event) {
    this.gaService.event("editor_open_file", "Editor", "Botão de Abrir arquivo");
    const { files } = event.target as HTMLInputElement;

    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    const contents = await this.fileService.getContents(file);

    this.title = file.name;
    this.titleChange.emit(file.name);
    this.code = contents;
  }

  private prepareFile(as: "text" | "binary", compat = false) {
    const blob = (() => {
      if (compat) {
        return new Blob([Uint8Array.from(encode(this.code ?? "", "ISO-8859-1"))], {
          type: `${as === "binary" ? "application/octet-stream" : "text/plain"}; charset=ISO-8859-1`,
        });
      }

      return new Blob([this.code ?? ""], {
        type: as === "binary" ? "application/octet-stream" : "text/plain",
      });
    })();

    let fileName = this.title || "Sem título";

    if (!fileName.endsWith(".por")) {
      fileName += ".por";
    }

    return { blob, fileName };
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

      this.snack.open("Arquivo salvo com sucesso!", "OK", {
        duration: 3000,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      console.error(error);

      this.snack.open("Ocorreu um erro ao salvar o arquivo!", "OK", {
        duration: 3000,
      });
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

  stdOutEditorCursorEnd() {
    if (!this.stdOutEditor) {
      return;
    }

    const editor = this.stdOutEditor;
    const model = editor.getModel();

    if (model) {
      // TODO: Find a better way to do this
      setTimeout(() => {
        editor.setPosition({
          lineNumber: model.getLineCount(),
          column: model.getLineMaxColumn(model.getLineCount()),
        });

        editor.setScrollPosition({
          scrollLeft: 0,
          scrollTop: editor.getScrollHeight(),
        });
      }, 1);

      editor.focus();
    }
  }

  initShortcuts(editor: monaco.editor.IStandaloneCodeEditor) {
    editor.addAction({
      id: "runCode",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      label: "Executar código",
      run: this.runCode.bind(this),
    });

    editor.addAction({
      id: "saveFile",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      label: "Salvar arquivo",
      run: () => {
        this.saveFile();
      },
    });

    editor.addAction({
      id: "openFile",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
      label: "Abrir arquivo",
      run: () => {
        this.fileInput().nativeElement.click();
      },
    });

    editor.addAction({
      id: "openHelp",
      keybindings: [monaco.KeyCode.F1],
      label: "Ajuda",
      run: this.openHelp.bind(this),
    });

    /** ⌘⇧A / Ctrl+Shift+A: o Monaco captura o atalho antes do ng-keyboard-shortcuts com foco no editor. */
    editor.addAction({
      id: "toggleTutorAria",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA],
      label: "Alternar tutor ARIA",
      run: () => {
        this.tutorToggleFromEditor();
      },
    });
  }

  onEditorInit(editor: monaco.editor.IStandaloneCodeEditor) {
    this.codeEditor = editor;
    if (this.isActiveTab) {
      this.editorActions.setEditor(editor);
      this.editorActions.setRunCode(() => {
        void this.runCode();
      });
    }
    this.initShortcuts(editor);

    editor.onDidScrollChange(() => {
      this.scheduleFlowSvgLayout();
    });

    this._code$?.unsubscribe();

    this._code$ = fromEventPattern(editor.onDidChangeModelContent)
      .pipe(
        tap(() => {
          if (this.tutorOverlay.isOpen()) {
            this.tutorOverlay.dim();
          }
        }),
        debounceTime(500),
        switchMap(async () => this.worker.checkCode(this.codeEditor?.getModel()?.getValue() ?? this.code ?? "")),
      )
      .subscribe({
        next: result => {
          const merged = result.errors.concat(result.parseErrors);
          this.setEditorErrors(merged);
          this.lastAstSummary = `erros:${merged.length};parse_ok:${merged.length === 0}`;
          const msgs = merged.map(
            e => `Linha ${e.startLine}, coluna ${e.startCol + 1}: ${e.message}`,
          );
          this.tutorRealtimeValidator.onErrorsUpdated(msgs);
          this.tutorProactivity.resetWatch(merged.length > 0);
          this.scheduleFlowSvgLayout();
        },
        error(err) {
          console.error(err);
        },
      });
  }

  private syncActiveEditorAndTutorContext(): void {
    if (this.isActiveTab) {
      this.tutorEditorContext.register(this.tutorContextHandle);
      if (this.codeEditor) {
        this.editorActions.setEditor(this.codeEditor);
        this.editorActions.setRunCode(() => {
          void this.runCode();
        });
        this.editorActions.setStopCode(() => {
          this.stopCode();
        });
      }
      this.scheduleFlowSvgLayout();
    } else {
      this.tutorEditorContext.unregister(this.tutorContextHandle);
    }
  }

  /** Remove destaques e comentários inline do tutor no Monaco (não limpa o chat). */
  clearTutorEditorDecorations(): void {
    this.editorActions.clearTutorDecorations();
    this.gaService.event("editor_tutor_clear_decorations", "Editor", "Limpar destaques do tutor");
  }

  openHelp() {
    this.gaService.event("editor_help_tab_open", "Editor", "Nova aba de ajuda através do Editor");
    this.help.emit();
  }

  openSettings() {
    this.gaService.event("editor_settings_open", "Editor", "Abrir diálogo de configurações");
    this.settings.emit();
  }

  async shareFile() {
    if (!this.code) {
      return;
    }

    this.sharing = true;

    const shareUrl = await this.shareService.share(this.code);

    if (shareUrl) {
      this.snack.openFromTemplate(this.shareSnackTemplate(), {
        data: {
          url: shareUrl,
        },
      });

      this.gaService.event("share_code_success", "Editor", "Código compartilhado com sucesso");
    } else {
      this.snack.open("Ocorreu um erro ao compartilhar o arquivo. Tente novamente mais tarde.", "OK", {
        duration: 3000,
      });

      this.gaService.event("share_code_error", "Editor", "Erro ao compartilhar código");
    }

    setTimeout(() => {
      this.sharing = false;
    }, 1000);
  }

  async copyStringAndCloseSnack(url: string) {
    await navigator.clipboard.writeText(url);
    this.snack.dismiss();
  }

  setEditorErrors(errors: PortugolCodeError[]) {
    const model = this.codeEditor?.getModel();

    const nextLineSet = new Set(errors.map(e => e.startLine));
    const clearedLines = [...this.lastCompilerErrorLines].filter(l => !nextLineSet.has(l));
    if (clearedLines.length > 0) {
      this.editorActions.flashResolvedCompilerLines(clearedLines);
    }
    this.lastCompilerErrorLines = nextLineSet;
    this.editorActions.setCompilerIssueLines([...nextLineSet]);

    if (model) {
      monaco.editor.setModelMarkers(
        model,
        "owner",
        errors.map(error => {
          return {
            startLineNumber: error.startLine,
            startColumn: error.startCol + 1,
            endLineNumber: error.endLine,
            endColumn: error.endCol + 2,
            message: error.message,
            severity: monaco.MarkerSeverity.Info,
          };
        }),
      );
    }
  }
}
