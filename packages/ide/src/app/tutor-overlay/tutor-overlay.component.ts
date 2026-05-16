import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  Injector,
  OnDestroy,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { AngularSvgIconModule } from "angular-svg-icon";

import { AgentChatComponent } from "../agent-chat/agent-chat.component";
import { TutorEditorContextService } from "../tutor-editor-context.service";
import { TutorHudLayoutService } from "../tutor-hud-layout.service";
import { TutorOverlayService } from "../tutor-overlay.service";

const VIEWPORT_MARGIN_PX = 12;

@Component({
  selector: "app-tutor-overlay",
  standalone: true,
  imports: [AgentChatComponent, MatButtonModule, AngularSvgIconModule],
  templateUrl: "./tutor-overlay.component.html",
  styleUrl: "./tutor-overlay.component.scss",
})
export class TutorOverlayComponent implements AfterViewInit, OnDestroy {
  private readonly tutorContext = inject(TutorEditorContextService);
  private readonly hudLayout = inject(TutorHudLayoutService);
  readonly shell = inject(TutorOverlayService);

  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  /** Semântica: tutor ausente ao leitor de ecrã quando o HUD está fechado. */
  @HostBinding("attr.aria-hidden")
  get ariaHiddenAttr(): true | null {
    return this.shell.isOpen() ? null : true;
  }
  private readonly injector = inject(Injector);

  readonly agentChat = viewChild(AgentChatComponent);
  readonly panelRef = viewChild<ElementRef<HTMLElement>>("panel");
  /** Raiz do cartão HUD — classes de abrir/dim aplicadas por effect (robusto após reparent ao body). */
  readonly overlayDiv = viewChild<ElementRef<HTMLElement>>("overlayRoot");

  readonly hudTransform = computed(() => {
    const o = this.hudLayout.hudOffset();
    return `translate(${o.dx}px, ${o.dy}px)`;
  });

  readonly dragging = signal(false);

  private panelResizeObserver: ResizeObserver | null = null;

  private dragSession: { dx: number; dy: number; px: number; py: number } | null = null;

  private dragCaptureBar: HTMLElement | null = null;

  private dragCapturePointerId: number | null = null;

  /**
   * Move o host para document.body em runtime para sair da cadeia overflow:hidden
   * do app-root (que bloqueia position:fixed em alguns motores).
   * O ViewRef mantém-se na árvore Angular — CD continua a funcionar normalmente.
   */
  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const el = this.hostRef.nativeElement;
    if (el.parentElement !== this.doc.body) {
      this.doc.body.appendChild(el);
    }
  }

  constructor() {
    effect(() => {
      const open = this.shell.isOpen();
      const dimmed = this.shell.isDimmed();
      const root = this.overlayDiv()?.nativeElement;
      if (root) {
        root.classList.toggle("tutor-overlay--open", open);
        root.classList.toggle("tutor-overlay--dimmed", open && dimmed);
      }
    });

    effect(() => {
      if (!this.shell.isOpen()) {
        return;
      }
      afterNextRender(
        () => {
          this.agentChat()?.focusComposer();
        },
        { injector: this.injector },
      );
    });

    effect(() => {
      const open = this.shell.isOpen();
      if (!open) {
        this.detachPanelResizeObserver();
        this.hudLayout.setPanelViewport(null);
        return;
      }
      afterNextRender(
        () => {
          this.attachPanelResizeObserver();
        },
        { injector: this.injector },
      );
    });
  }

  ngOnDestroy(): void {
    this.detachPanelResizeObserver();
    this.hudLayout.setPanelViewport(null);
  }

  private attachPanelResizeObserver(): void {
    const el = this.panelRef()?.nativeElement;
    if (!el) {
      return;
    }
    this.detachPanelResizeObserver();
    const update = (): void => {
      this.hudLayout.setPanelViewport(el.getBoundingClientRect());
    };
    update();
    this.clampPanelToViewport();
    this.panelResizeObserver = new ResizeObserver(() => update());
    this.panelResizeObserver.observe(el);
  }

  private detachPanelResizeObserver(): void {
    if (this.panelResizeObserver) {
      this.panelResizeObserver.disconnect();
      this.panelResizeObserver = null;
    }
  }

  @HostListener("window:resize")
  onWindowResize(): void {
    if (!this.shell.isOpen() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.clampPanelToViewport();
    const el = this.panelRef()?.nativeElement;
    if (el) {
      this.hudLayout.setPanelViewport(el.getBoundingClientRect());
    }
  }

  private clampPanelToViewport(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const el = this.panelRef()?.nativeElement;
    if (!el) {
      return;
    }
    const margin = VIEWPORT_MARGIN_PX;
    let iterations = 0;
    while (iterations < 6) {
      iterations += 1;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let adjustDx = 0;
      let adjustDy = 0;
      if (rect.left < margin) {
        adjustDx += margin - rect.left;
      }
      if (rect.right > vw - margin) {
        adjustDx -= rect.right - (vw - margin);
      }
      if (rect.top < margin) {
        adjustDy += margin - rect.top;
      }
      if (rect.bottom > vh - margin) {
        adjustDy -= rect.bottom - (vh - margin);
      }
      if (adjustDx === 0 && adjustDy === 0) {
        break;
      }
      const o = this.hudLayout.hudOffset();
      this.hudLayout.setHudOffset(o.dx + adjustDx, o.dy + adjustDy);
    }
  }

  onDragPointerDown(ev: PointerEvent): void {
    if (!isPlatformBrowser(this.platformId) || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const bar = ev.currentTarget as HTMLElement;
    const o = this.hudLayout.hudOffset();
    this.dragSession = { dx: o.dx, dy: o.dy, px: ev.clientX, py: ev.clientY };
    this.dragging.set(true);
    this.dragCaptureBar = bar;
    this.dragCapturePointerId = ev.pointerId;
    bar.setPointerCapture(ev.pointerId);
  }

  onDragPointerMove(ev: PointerEvent): void {
    if (!this.dragSession) {
      return;
    }
    const s = this.dragSession;
    const nx = s.dx + (ev.clientX - s.px);
    const ny = s.dy + (ev.clientY - s.py);
    this.hudLayout.setHudOffset(nx, ny);
    this.clampPanelToViewport();
    const co = this.hudLayout.hudOffset();
    this.dragSession = { dx: co.dx, dy: co.dy, px: ev.clientX, py: ev.clientY };
    const el = this.panelRef()?.nativeElement;
    if (el) {
      this.hudLayout.setPanelViewport(el.getBoundingClientRect());
    }
  }

  onDragPointerUp(ev: PointerEvent): void {
    if (this.dragCaptureBar !== null && this.dragCapturePointerId !== null) {
      try {
        this.dragCaptureBar.releasePointerCapture(this.dragCapturePointerId);
      } catch {
        /* ignore */
      }
    }
    this.dragCaptureBar = null;
    this.dragCapturePointerId = null;
    this.dragSession = null;
    this.dragging.set(false);
    const el = this.panelRef()?.nativeElement;
    if (el) {
      this.hudLayout.setPanelViewport(el.getBoundingClientRect());
    }
  }

  onExpandImmersiveHistory(ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.agentChat()?.expandImmersiveHudHistory();
  }

  onHudClearConversation(ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.agentChat()?.clearConversation();
  }

  onHudClose(ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.close();
  }

  resetHudPosition(ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.hudLayout.resetHudOffset();
    afterNextRender(
      () => {
        this.clampPanelToViewport();
        const el = this.panelRef()?.nativeElement;
        if (el) {
          this.hudLayout.setPanelViewport(el.getBoundingClientRect());
        }
      },
      { injector: this.injector },
    );
  }

  activeContext(): ReturnType<TutorEditorContextService["getActive"]> {
    return this.tutorContext.getActive();
  }

  readonly cursorLineResolver = (): number | undefined => this.tutorContext.getActive()?.getCursorLine?.() ?? undefined;

  readonly cursorColumnResolver = (): number | undefined =>
    this.tutorContext.getActive()?.getCursorColumn?.() ?? undefined;

  readonly astSummaryResolver = (): string | undefined => this.tutorContext.getActive()?.getAstSummary?.() ?? undefined;

  readonly dataFlowContextResolver = (): string | undefined =>
    this.tutorContext.getActive()?.getDataFlowContext?.() ?? undefined;

  readonly compilerLinesResolver = (): number[] => this.tutorContext.getActive()?.getCompilerErrorLines?.() ?? [];

  close(): void {
    this.shell.hide();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.shell.isOpen()) {
      this.close();
    }
  }
}
