import { DestroyRef, Injectable, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { createTelemetryQueue } from "@luisricar-do/agent";
import type { TelemetryEnvelope, TelemetryQueue } from "@luisricar-do/agent";
import { GoogleAnalyticsService } from "ngx-google-analytics";

import { environment } from "../environments/environment";
import { TutorChatSessionService } from "./tutor-chat-session.service";
import { TutorEditorContextService } from "./tutor-editor-context.service";
import { TutorOverlayService } from "./tutor-overlay.service";
import { TutorStudySessionService } from "./tutor-study-session.service";

/** Pseudónimo do navegador: persiste entre sessões (não identifica a pessoa). */
const INSTALL_ID_KEY = "pws:tutor:installId";
/** Identificador da sessão (aba); reinicia ao abrir nova aba. */
const SESSION_ID_KEY = "pws:tutor:sessionId";
/** Atribuição da pesquisa, lida da query string na primeira carga. */
const PARTICIPANT_ID_KEY = "pws:tutor:participantId";
const CONDITION_KEY = "pws:tutor:condition";

const FLUSH_INTERVAL_MS = 10_000;

/**
 * Esquema de eventos do protocolo da dissertação (Subseção "Telemetria mínima").
 * Os tipos ainda sem emissor ficam disponíveis para a instrumentação por tarefa.
 */
export type TutorTelemetryEventType =
  | "session_start"
  | "app_reload"
  | "task_start"
  | "task_end"
  | "code_edit"
  | "compile"
  | "run"
  | "chat_turn_user"
  | "chat_turn_assistant"
  | "first_help_request"
  | "hint_level_changed"
  | "sse_error"
  | "api_error"
  | "compile_trigger_fired"
  | "compile_trigger_skipped_active_chat";

export interface TutorTelemetryEvent {
  type: TutorTelemetryEventType;
  ts?: string;
  seq?: number;
  tabKey?: string;
  hudOpen?: boolean;
  dialogTurnCount?: number;
  userMessageCount?: number;
  fromLevel?: number;
  toLevel?: number;
  /** Índice da tarefa (1–6) quando a sessão de pesquisa estiver em curso. */
  task?: number;
  /** Classe de falha do compilador (`syntax`, `type_mismatch`, …). */
  errorClass?: string;
  [key: string]: unknown;
}

@Injectable({ providedIn: "root" })
export class TutorTelemetryService {
  private readonly gaService = inject(GoogleAnalyticsService);
  private readonly tutorOverlay = inject(TutorOverlayService);
  private readonly tutorEditorContext = inject(TutorEditorContextService);
  private readonly chatSession = inject(TutorChatSessionService);
  private readonly studySession = inject(TutorStudySessionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly envelope: TelemetryEnvelope;
  private readonly queue: TelemetryQueue | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.envelope = this.buildEnvelope();
    this.queue = this.createQueue();

    this.studySession.setParticipant(this.envelope.participantId, this.envelope.condition);

    if (this.queue) {
      // O `sessionId` sobrevive ao recarregamento da aba: sem esta distinção, a
      // sessão apareceria no dataset com vários `session_start`.
      this.log({ type: this.queue.lastSeq() > 0 ? "app_reload" : "session_start" });
      this.observeTaskLifecycle();
      this.startFlushLoop();
      this.exposeDebugHooks();
    }
  }

  /**
   * Identificador da sessão da IDE, enviado ao serviço em cada pedido de ajuda: é a chave que
   * liga os turnos registados no serviço à sessão de coleta.
   */
  get sessionId(): string {
    return this.envelope.sessionId;
  }

  /** Registra o evento na fila durável; o envio para o backend é assíncrono. */
  log(event: TutorTelemetryEvent): void {
    if (!environment.enableTutorTelemetry || !this.queue) {
      return;
    }

    this.queue.enqueue({
      ...this.studySession.taskContext(),
      ...event,
      tabKey: event.tabKey ?? this.activeTabKey(),
      hudOpen: event.hudOpen ?? this.tutorOverlay.isOpen(),
      dialogTurnCount: event.dialogTurnCount ?? this.chatSession.dialogTurnCount(),
      userMessageCount: event.userMessageCount ?? this.chatSession.userMessageCount(),
    });

    this.forwardToAnalytics(event);
  }

  logHintLevelChanged(fromLevel: 1 | 2 | 3, toLevel: 1 | 2 | 3): void {
    if (fromLevel === toLevel) {
      return;
    }
    this.log({ type: "hint_level_changed", fromLevel, toLevel });
    this.gaService.event("tutor_hint_level", "Tutor", `Nível ${fromLevel} → ${toLevel}`, toLevel);
  }

  /** Eventos desta sessão ainda não confirmados pelo servidor. */
  dumpEvents(): TutorTelemetryEvent[] {
    return (this.queue?.pending() ?? []) as TutorTelemetryEvent[];
  }

  /** Força o envio do que estiver pendente (fim de sessão, troca de tarefa). */
  async flush(): Promise<number> {
    return (await this.queue?.flushAll()) ?? 0;
  }

  /** Cópia de segurança local: todas as sessões deste navegador, em JSON. */
  exportSessionsAsJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        envelope: this.envelope,
        sessions: this.queue?.exportAllSessions() ?? {},
      },
      undefined,
      2,
    );
  }

  /** Descarrega a cópia de segurança (camada de contingência da coleta). */
  downloadSessionsBackup(): void {
    if (typeof document === "undefined") {
      return;
    }
    const blob = new Blob([this.exportSessionsAsJson()], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `telemetria-${this.envelope.participantId ?? this.envelope.installId}-${this.envelope.sessionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Atribuição do participante (barra de sessão ou console do pesquisador). */
  setParticipant(participantId: string, condition?: string): void {
    const normalizedId = participantId.trim().slice(0, 64);
    if (normalizedId) {
      this.envelope.participantId = normalizedId;
      this.writeStorage(sessionStorage, PARTICIPANT_ID_KEY, normalizedId);
    }
    const normalizedCondition = this.normalizeCondition(condition);
    if (normalizedCondition) {
      this.envelope.condition = normalizedCondition;
      this.writeStorage(sessionStorage, CONDITION_KEY, normalizedCondition);
    }
  }

  private createQueue(): TelemetryQueue | undefined {
    const baseUrl = environment.agentApiBaseUrl?.trim();
    if (!environment.enableTutorTelemetry || !baseUrl) {
      return undefined;
    }
    if (typeof localStorage === "undefined") {
      return undefined;
    }
    return createTelemetryQueue({
      baseUrl,
      envelope: this.envelope,
      storage: localStorage,
    });
  }

  private buildEnvelope(): TelemetryEnvelope {
    const params = this.queryParams();
    const participantFromUrl = params.get("pid")?.trim();
    const conditionFromUrl = this.normalizeCondition(params.get("cond") ?? undefined);

    if (participantFromUrl) {
      this.writeStorage(sessionStorage, PARTICIPANT_ID_KEY, participantFromUrl.slice(0, 64));
    }
    if (conditionFromUrl) {
      this.writeStorage(sessionStorage, CONDITION_KEY, conditionFromUrl);
    }

    return {
      installId: this.ensureId(localStorage, INSTALL_ID_KEY, "inst"),
      sessionId: this.ensureId(sessionStorage, SESSION_ID_KEY, "sess"),
      participantId: this.readStorage(sessionStorage, PARTICIPANT_ID_KEY),
      condition: this.readStorage(sessionStorage, CONDITION_KEY),
      buildSha: environment.commitSha,
    };
  }

  /**
   * `task_start` / `task_end` vêm do serviço de sessão, não da UI: assim o
   * `timeout` automático do timebox também fica registado.
   */
  private observeTaskLifecycle(): void {
    this.studySession.lifecycle$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event.kind === "started") {
        this.log({
          type: "task_start",
          task: event.task.index,
          taskLabel: event.task.label,
          timeboxMs: event.task.timeboxMs,
        });
        return;
      }

      this.log({
        type: "task_end",
        task: event.task.index,
        taskLabel: event.task.label,
        timeboxMs: event.task.timeboxMs,
        taskElapsedMs: event.elapsedMs,
        outcome: event.outcome,
        studentTurns: event.studentTurns,
      });
      // Fecha a tarefa também no servidor: evita perder o desfecho se a sessão
      // terminar logo depois.
      void this.queue?.flush();
    });
  }

  private startFlushLoop(): void {
    if (typeof window === "undefined") {
      return;
    }

    this.flushTimer = setInterval(() => void this.queue?.flush(), FLUSH_INTERVAL_MS);

    // `pagehide` cobre fecho de aba e navegação; `keepalive` no fetch permite
    // que o último lote saia mesmo com a página a descarregar.
    const onPageHide = () => void this.queue?.flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void this.queue?.flush();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    this.destroyRef.onDestroy(() => {
      if (this.flushTimer !== undefined) {
        clearInterval(this.flushTimer);
      }
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  }

  private exposeDebugHooks(): void {
    if (typeof window === "undefined" || !window.location.search.includes("tutorTelemetry=1")) {
      return;
    }
    const hooks = window as Window & {
      dumpTutorTelemetry?: () => TutorTelemetryEvent[];
      flushTutorTelemetry?: () => Promise<number>;
      downloadTutorTelemetry?: () => void;
    };
    hooks.dumpTutorTelemetry = () => this.dumpEvents();
    hooks.flushTutorTelemetry = () => this.flush();
    hooks.downloadTutorTelemetry = () => {
      this.downloadSessionsBackup();
    };
  }

  private queryParams(): URLSearchParams {
    try {
      return new URLSearchParams(window.location.search);
    } catch {
      return new URLSearchParams();
    }
  }

  /** Rótulo da etapa de coleta: slug curto, sem braços fixos (ver `StudyCondition`). */
  private normalizeCondition(raw: string | undefined): string | undefined {
    const slug = (raw ?? "")
      .trim()
      .toLowerCase()
      .replaceAll(/[^\d_a-z-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 64);
    return slug || undefined;
  }

  private ensureId(store: Storage, key: string, prefix: string): string {
    const existing = this.readStorage(store, key);
    if (existing) {
      return existing;
    }
    const id = `${prefix}-${this.randomId()}`;
    this.writeStorage(store, key, id);
    return id;
  }

  /** Só `[A-Za-z0-9_-]`: o identificador entra no caminho do blob no servidor. */
  private randomId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replaceAll("-", "");
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`;
  }

  private readStorage(store: Storage, key: string): string | undefined {
    try {
      return store.getItem(key)?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private writeStorage(store: Storage, key: string, value: string): void {
    try {
      store.setItem(key, value);
    } catch {
      /* quota esgotada ou modo privado */
    }
  }

  private activeTabKey(): string | undefined {
    return this.tutorEditorContext.getActive()?.getTabKey?.() ?? undefined;
  }

  private forwardToAnalytics(event: TutorTelemetryEvent): void {
    switch (event.type) {
      case "compile_trigger_fired": {
        this.gaService.event("tutor_compile_trigger", "Tutor", "Disparado após erro de compilação");
        break;
      }
      case "compile_trigger_skipped_active_chat": {
        this.gaService.event("tutor_compile_trigger_skipped", "Tutor", "Ignorado — conversa activa");
        break;
      }
      default: {
        break;
      }
    }
  }
}
