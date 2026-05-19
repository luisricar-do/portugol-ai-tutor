import { Injectable, inject, signal } from "@angular/core";

import { TutorTelemetryService } from "./tutor-telemetry.service";

const STORAGE_KEY_NAME = "pws:tutor:studentName";
const STORAGE_KEY_HINT = "pws:tutor:hintLevel";
/** Prefixo localStorage: `pws:tutor:welcomeShown:{tabKey}` — tabKey = ID da aba do editor, não do browser. */
const WELCOME_PREFIX = "pws:tutor:welcomeShown:";

@Injectable({ providedIn: "root" })
export class TutorSettingsService {
  private readonly telemetry = inject(TutorTelemetryService);

  private readonly nameSignal = signal<string | null>(null);

  private readonly hintLevelSignal = signal<1 | 2 | 3>(1);

  readonly studentName = this.nameSignal.asReadonly();

  readonly hintLevel = this.hintLevelSignal.asReadonly();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_NAME);
      if (raw && raw.trim()) {
        this.nameSignal.set(raw.trim());
      }
    } catch {
      /* ignore */
    }
    try {
      const hl = Number(localStorage.getItem(STORAGE_KEY_HINT));
      if (hl === 2 || hl === 3) {
        this.hintLevelSignal.set(hl);
      }
    } catch {
      /* ignore */
    }
  }

  setStudentName(name: string | null): void {
    const trimmed = name?.trim() ?? "";
    if (!trimmed) {
      this.nameSignal.set(null);
      try {
        localStorage.removeItem(STORAGE_KEY_NAME);
      } catch {
        /* ignore */
      }
      return;
    }
    this.nameSignal.set(trimmed);
    try {
      localStorage.setItem(STORAGE_KEY_NAME, trimmed);
    } catch {
      /* ignore */
    }
  }

  setHintLevel(level: 1 | 2 | 3): void {
    const prev = this.hintLevelSignal();
    const next = level === 2 || level === 3 ? level : 1;
    if (prev === next) {
      return;
    }
    this.hintLevelSignal.set(next);
    try {
      localStorage.setItem(STORAGE_KEY_HINT, String(next));
    } catch {
      /* ignore */
    }
    this.telemetry.logHintLevelChanged(prev, next);
  }

  /**
   * Boas-vindas já mostradas para esta aba do editor Portugol (`tab.id` em AppComponent).
   * Persiste em localStorage — sobrevive a reload da página (não é sessionStorage do browser).
   */
  hasWelcomeShown(tabKey: string): boolean {
    if (!tabKey) {
      return false;
    }
    try {
      return localStorage.getItem(WELCOME_PREFIX + tabKey) === "1";
    } catch {
      return false;
    }
  }

  /** Marca boas-vindas para a aba do editor identificada por `tabKey` (ver {@link hasWelcomeShown}). */
  markWelcomeShown(tabKey: string): void {
    if (!tabKey) {
      return;
    }
    try {
      localStorage.setItem(WELCOME_PREFIX + tabKey, "1");
    } catch {
      /* ignore */
    }
  }
}
