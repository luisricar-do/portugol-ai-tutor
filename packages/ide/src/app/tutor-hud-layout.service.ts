import { Injectable, signal } from "@angular/core";

const OFFSET_STORAGE_KEY = "pws:tutor:hudOffset";
const SIZE_STORAGE_KEY = "pws:tutor:hudSize";

/** Largura mínima do painel (~17.5rem). */
export const TUTOR_HUD_MIN_WIDTH_PX = 280;

/** Altura mínima do painel (~20rem). */
export const TUTOR_HUD_MIN_HEIGHT_PX = 320;

const VIEWPORT_MARGIN_PX = 12;

/**
 * Após arrastar o HUD manualmente, `nudgeHudAwayFromLine` não altera o offset durante este intervalo.
 * Limiar pedagógico (8s): evita “lutar” com o aluno que acabou de posicionar o painel.
 */
export const TUTOR_HUD_DRAG_NUDGE_SUPPRESS_MS = 8_000;

/** Retângulo do painel HUD em coordenadas do viewport (getBoundingClientRect). */
export interface TutorHudPanelViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Deslocamento em px aplicado ao painel (translate) ao arrastar a barra “Mover”. */
export interface TutorHudPixelOffset {
  readonly dx: number;
  readonly dy: number;
}

/** Dimensões customizadas do painel (px). */
export interface TutorHudPixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Geometria do overlay inferior para a “corda fantasma” até a linha no Monaco.
 * Atualizado por {@link TutorOverlayComponent} via ResizeObserver.
 */
@Injectable({ providedIn: "root" })
export class TutorHudLayoutService {
  private readonly panelViewportSignal = signal<TutorHudPanelViewport | null>(null);

  private readonly hudOffsetSignal = signal<TutorHudPixelOffset>({ dx: 0, dy: 0 });

  private readonly hudSizeSignal = signal<TutorHudPixelSize | null>(null);

  private userDraggedAt = 0;

  /** Linha 1-based em destaque pelo tutor (atenua outros erros no editor). */
  private tutorPrimaryErrorLine: number | null = null;

  readonly panelViewport = this.panelViewportSignal.asReadonly();

  readonly hudOffset = this.hudOffsetSignal.asReadonly();

  readonly hudSize = this.hudSizeSignal.asReadonly();

  /**
   * Limites máximos de largura/altura em função do viewport.
   */
  static maxSizeForViewport(): TutorHudPixelSize {
    if (typeof window === "undefined") {
      return { width: 672, height: 480 };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = VIEWPORT_MARGIN_PX;
    return {
      width: Math.max(TUTOR_HUD_MIN_WIDTH_PX, Math.round(Math.min(vw * 0.92, vw - margin * 2))),
      height: Math.max(
        TUTOR_HUD_MIN_HEIGHT_PX,
        Math.round(Math.min(vh * 0.9, vh - margin * 2 - 48)),
      ),
    };
  }

  /**
   * Limita o translate do HUD ao que faz sentido para um cartão centrado no fundo
   * (~metade do viewport). Usado em toda escrita e ao ler o localStorage.
   */
  private static clampOffset(dx: number, dy: number): TutorHudPixelOffset {
    if (typeof window === "undefined") {
      return { dx: 0, dy: 0 };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxDx = Math.max(120, Math.round(w * 0.45));
    const maxDy = Math.max(80, Math.round(h * 0.45));
    return {
      dx: Math.max(-maxDx, Math.min(maxDx, dx)),
      dy: Math.max(-maxDy, Math.min(maxDy, dy)),
    };
  }

  static clampSize(width: number, height: number): TutorHudPixelSize {
    const max = TutorHudLayoutService.maxSizeForViewport();
    return {
      width: Math.max(TUTOR_HUD_MIN_WIDTH_PX, Math.min(max.width, Math.round(width))),
      height: Math.max(TUTOR_HUD_MIN_HEIGHT_PX, Math.min(max.height, Math.round(height))),
    };
  }

  constructor() {
    if (typeof window === "undefined") {
      return;
    }
    this.loadStoredOffset();
    this.loadStoredSize();
  }

  private loadStoredOffset(): void {
    try {
      const raw = localStorage.getItem(OFFSET_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const p = JSON.parse(raw) as Partial<TutorHudPixelOffset>;
      if (
        typeof p.dx !== "number" ||
        typeof p.dy !== "number" ||
        !Number.isFinite(p.dx) ||
        !Number.isFinite(p.dy)
      ) {
        this.clearStoredOffset();
        return;
      }
      const looseMaxDx = window.innerWidth * 0.55;
      const looseMaxDy = window.innerHeight * 0.55;
      if (Math.abs(p.dx) > looseMaxDx || Math.abs(p.dy) > looseMaxDy) {
        this.clearStoredOffset();
        return;
      }
      const next = TutorHudLayoutService.clampOffset(p.dx, p.dy);
      this.hudOffsetSignal.set(next);
      if (next.dx !== p.dx || next.dy !== p.dy) {
        try {
          localStorage.setItem(OFFSET_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
    } catch {
      this.clearStoredOffset();
    }
  }

  private loadStoredSize(): void {
    try {
      const raw = localStorage.getItem(SIZE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const p = JSON.parse(raw) as Partial<TutorHudPixelSize>;
      if (
        typeof p.width !== "number" ||
        typeof p.height !== "number" ||
        !Number.isFinite(p.width) ||
        !Number.isFinite(p.height) ||
        p.width <= 0 ||
        p.height <= 0
      ) {
        this.clearStoredSize();
        return;
      }
      const max = TutorHudLayoutService.maxSizeForViewport();
      if (p.width > max.width * 1.05 || p.height > max.height * 1.05) {
        this.clearStoredSize();
        return;
      }
      const next = TutorHudLayoutService.clampSize(p.width, p.height);
      this.hudSizeSignal.set(next);
      if (next.width !== p.width || next.height !== p.height) {
        try {
          localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
    } catch {
      this.clearStoredSize();
    }
  }

  private clearStoredOffset(): void {
    this.hudOffsetSignal.set({ dx: 0, dy: 0 });
    try {
      localStorage.removeItem(OFFSET_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private clearStoredSize(): void {
    this.hudSizeSignal.set(null);
    try {
      localStorage.removeItem(SIZE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  setPanelViewport(rect: DOMRect | TutorHudPanelViewport | null): void {
    if (!rect) {
      this.panelViewportSignal.set(null);
      return;
    }
    this.panelViewportSignal.set({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  setHudOffset(dx: number, dy: number): void {
    const next = TutorHudLayoutService.clampOffset(dx, dy);
    this.hudOffsetSignal.set(next);
    try {
      localStorage.setItem(OFFSET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  noteUserDrag(): void {
    this.userDraggedAt = Date.now();
  }

  /** Verdadeiro se o utilizador arrastou o painel há menos de {@link TUTOR_HUD_DRAG_NUDGE_SUPPRESS_MS}. */
  wasUserDraggedRecently(): boolean {
    return Date.now() - this.userDraggedAt < TUTOR_HUD_DRAG_NUDGE_SUPPRESS_MS;
  }

  setTutorPrimaryErrorLine(line: number | null): void {
    if (line == null || !Number.isFinite(line) || line < 1) {
      this.tutorPrimaryErrorLine = null;
      return;
    }
    this.tutorPrimaryErrorLine = Math.trunc(line);
  }

  getTutorPrimaryErrorLine(): number | null {
    return this.tutorPrimaryErrorLine;
  }

  /**
   * Desloca o HUD para não cobrir a faixa vertical da linha no editor (viewport).
   */
  nudgeHudAwayFromLine(lineTop: number, lineHeight: number): void {
    if (typeof window === "undefined") {
      return;
    }
    if (this.wasUserDraggedRecently()) {
      return;
    }
    const panel = this.panelViewportSignal();
    if (!panel) {
      return;
    }
    const lineBottom = lineTop + lineHeight;
    const panelTop = panel.top;
    const panelBottom = panel.top + panel.height;
    const margin = 12;
    const lineBandTop = lineTop - margin;
    const lineBandBottom = lineBottom + margin;
    const overlaps = panelTop < lineBandBottom && panelBottom > lineBandTop;
    if (!overlaps) {
      return;
    }
    const o = this.hudOffsetSignal();
    const moveUp = panelBottom - lineBandTop + margin;
    const moveDown = lineBandBottom - panelTop + margin;
    let dy = o.dy;
    if (lineTop > window.innerHeight * 0.45) {
      dy -= moveUp;
    } else {
      dy += moveDown;
    }
    this.setHudOffset(o.dx, dy);
  }

  setHudSize(width: number, height: number): void {
    const next = TutorHudLayoutService.clampSize(width, height);
    this.hudSizeSignal.set(next);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  /** Reaplica limites ao tamanho guardado (ex.: após resize da janela). */
  reclampHudSize(): void {
    const current = this.hudSizeSignal();
    if (!current) {
      return;
    }
    const next = TutorHudLayoutService.clampSize(current.width, current.height);
    if (next.width === current.width && next.height === current.height) {
      return;
    }
    this.hudSizeSignal.set(next);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  /** Repõe posição e tamanho ao default. */
  resetHudOffset(): void {
    this.clearStoredOffset();
    this.clearStoredSize();
  }

  resetHudLayout(): void {
    this.resetHudOffset();
  }
}
