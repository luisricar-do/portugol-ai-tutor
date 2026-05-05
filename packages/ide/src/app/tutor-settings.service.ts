import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "pws:tutor:studentName";

@Injectable({ providedIn: "root" })
export class TutorSettingsService {
  private readonly nameSignal = signal<string | null>(null);

  readonly studentName = this.nameSignal.asReadonly();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && raw.trim()) {
        this.nameSignal.set(raw.trim());
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
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    this.nameSignal.set(trimmed);
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* ignore */
    }
  }
}
