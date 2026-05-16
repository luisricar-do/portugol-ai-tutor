import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "pws:tutor:hudOffset";

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

/**
 * Geometria do overlay inferior para a “corda fantasma” até a linha no Monaco.
 * Atualizado por {@link TutorOverlayComponent} via ResizeObserver.
 */
@Injectable({ providedIn: "root" })
export class TutorHudLayoutService {
  private readonly panelViewportSignal = signal<TutorHudPanelViewport | null>(null);

  private readonly hudOffsetSignal = signal<TutorHudPixelOffset>({ dx: 0, dy: 0 });

  readonly panelViewport = this.panelViewportSignal.asReadonly();

  readonly hudOffset = this.hudOffsetSignal.asReadonly();

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

  constructor() {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
      // Valores de versões antigas / bug (ex. milhares de px): repor ao centro.
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
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
    } catch {
      this.clearStoredOffset();
    }
  }

  private clearStoredOffset(): void {
    this.hudOffsetSignal.set({ dx: 0, dy: 0 });
    try {
      localStorage.removeItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  resetHudOffset(): void {
    this.clearStoredOffset();
  }
}
