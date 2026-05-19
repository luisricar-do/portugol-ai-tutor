import { Injectable, inject } from "@angular/core";
import { GoogleAnalyticsService } from "ngx-google-analytics";

import { environment } from "../environments/environment";
import { TutorChatSessionService } from "./tutor-chat-session.service";
import { TutorEditorContextService } from "./tutor-editor-context.service";
import { TutorOverlayService } from "./tutor-overlay.service";

const TELEMETRY_STORAGE_KEY = "pws:tutor:telemetry:v1";
const SESSION_ID_KEY = "pws:tutor:sessionId";
const MAX_EVENTS = 500;

export type TutorTelemetryEventType =
  | "hint_level_changed"
  | "compile_trigger_fired"
  | "compile_trigger_skipped_active_chat";

export interface TutorTelemetryEvent {
  type: TutorTelemetryEventType;
  ts: string;
  sessionId: string;
  buildSha: string;
  tabKey?: string;
  hudOpen?: boolean;
  dialogTurnCount?: number;
  userMessageCount?: number;
  fromLevel?: number;
  toLevel?: number;
}

@Injectable({ providedIn: "root" })
export class TutorTelemetryService {
  private readonly gaService = inject(GoogleAnalyticsService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorEditorContext = inject(TutorEditorContextService);
  private readonly chatSession = inject(TutorChatSessionService);

  private readonly sessionId: string;

  constructor() {
    this.sessionId = this.ensureSessionId();
    if (typeof window !== "undefined" && window.location.search.includes("tutorTelemetry=1")) {
      (window as Window & { dumpTutorTelemetry?: () => TutorTelemetryEvent[] }).dumpTutorTelemetry =
        () => this.dumpEvents();
    }
  }

  log(event: Omit<TutorTelemetryEvent, "ts" | "sessionId" | "buildSha"> & { ts?: string }): void {
    if (!environment.enableTutorTelemetry) {
      return;
    }

    const full: TutorTelemetryEvent = {
      ...event,
      ts: event.ts ?? new Date().toISOString(),
      sessionId: this.sessionId,
      buildSha: environment.commitSha,
      tabKey: event.tabKey ?? this.activeTabKey(),
      hudOpen: event.hudOpen ?? this.tutorOverlay.isOpen(),
      dialogTurnCount: event.dialogTurnCount ?? this.chatSession.dialogTurnCount(),
      userMessageCount: event.userMessageCount ?? this.chatSession.userMessageCount(),
    };

    this.appendToBuffer(full);
    this.forwardToAnalytics(full);
  }

  logHintLevelChanged(fromLevel: 1 | 2 | 3, toLevel: 1 | 2 | 3): void {
    if (fromLevel === toLevel) {
      return;
    }
    this.log({
      type: "hint_level_changed",
      fromLevel,
      toLevel,
    });
    this.gaService.event("tutor_hint_level", "Tutor", `Nível ${fromLevel} → ${toLevel}`, toLevel);
  }

  dumpEvents(): TutorTelemetryEvent[] {
    try {
      const raw = sessionStorage.getItem(TELEMETRY_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as TutorTelemetryEvent[]) : [];
    } catch {
      return [];
    }
  }

  private ensureSessionId(): string {
    try {
      const existing = sessionStorage.getItem(SESSION_ID_KEY);
      if (existing?.trim()) {
        return existing.trim();
      }
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem(SESSION_ID_KEY, id);
      return id;
    } catch {
      return `sess-${Date.now()}`;
    }
  }

  private activeTabKey(): string | undefined {
    return this.tutorEditorContext.getActive()?.getTabKey?.() ?? undefined;
  }

  private appendToBuffer(event: TutorTelemetryEvent): void {
    try {
      const prev = this.dumpEvents();
      const next = [...prev, event].slice(-MAX_EVENTS);
      sessionStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private forwardToAnalytics(event: TutorTelemetryEvent): void {
    switch (event.type) {
      case "compile_trigger_fired":
        this.gaService.event("tutor_compile_trigger", "Tutor", "Disparado após erro de compilação");
        break;
      case "compile_trigger_skipped_active_chat":
        this.gaService.event(
          "tutor_compile_trigger_skipped",
          "Tutor",
          "Ignorado — conversa activa",
        );
        break;
      default:
        break;
    }
  }
}
