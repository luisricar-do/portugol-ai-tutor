import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "pws:tutor:hudOffset";

/** Retângulo do painel HUD em coordenadas do viewport (getBoundingClientRect). */
export interface TutorHudPanelViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Deslocamento em px aplicado ao painel (translate) relativamente à posição por defeito. */
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

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const p = JSON.parse(raw) as Partial<TutorHudPixelOffset>;
      if (
        typeof p.dx === "number" &&
        typeof p.dy === "number" &&
        Number.isFinite(p.dx) &&
        Number.isFinite(p.dy)
      ) {
        this.hudOffsetSignal.set({ dx: p.dx, dy: p.dy });
      }
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
    const next: TutorHudPixelOffset = { dx, dy };
    this.hudOffsetSignal.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  resetHudOffset(): void {
    this.setHudOffset(0, 0);
  }
}
