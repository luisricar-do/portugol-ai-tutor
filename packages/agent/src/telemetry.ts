/**
 * Fila durável de telemetria da IDE (dissertação).
 *
 * Grava cada evento em `localStorage` antes de qualquer tentativa de rede, envia
 * em lotes para `POST {baseUrl}/telemetry` e mantém o lote na fila enquanto o
 * servidor não confirmar. Perdas são contadas e emitidas como evento próprio,
 * para que a análise consiga distinguir falha de instrumentação de ausência real
 * de atividade.
 */

/** Subconjunto de `localStorage` usado pela fila (permite fake nos testes). */
export interface TelemetryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** Identidade da sessão; acompanha todos os lotes enviados. */
export interface TelemetryEnvelope {
  /** Pseudónimo persistente do navegador (`localStorage`). */
  installId: string;
  /** Identificador da sessão (aba) corrente. */
  sessionId: string;
  /** Código do participante atribuído pelo pesquisador (ex.: `P07`). */
  participantId?: string;
  /** Rótulo livre da etapa de coleta (ex.: `piloto`, `turma-2026-1`); não é braço experimental. */
  condition?: string;
  buildSha?: string;
  promptHash?: string;
}

/** Evento tal como é registado pelos serviços da IDE (sem `seq`). */
export interface TelemetryEventInput {
  type: string;
  ts?: string;
  [key: string]: unknown;
}

/** Evento já persistido: `seq` monotónico por sessão e `ts` obrigatório. */
export interface TelemetryQueuedEvent extends TelemetryEventInput {
  seq: number;
  ts: string;
}

interface TelemetrySessionRecord {
  lastSeq: number;
  /** Eventos descartados por falta de espaço na fila, ainda não reportados. */
  dropped: number;
  events: TelemetryQueuedEvent[];
}

export interface CreateTelemetryQueueOptions {
  baseUrl: string;
  envelope: TelemetryEnvelope;
  storage: TelemetryStorage;
  fetch?: typeof fetch;
  /** Eventos por lote (o servidor aceita até 500). */
  batchSize?: number;
  /** Tecto da fila persistida; acima disso os eventos novos são contados como perdidos. */
  maxQueued?: number;
  /** Injetável nos testes. */
  now?: () => Date;
}

export interface TelemetryQueue {
  /** Persiste o evento e devolve-o já com `seq` e `ts`. `null` se a fila estiver cheia. */
  enqueue(event: TelemetryEventInput): TelemetryQueuedEvent | null;
  /**
   * Envia um lote. Devolve o nº de eventos confirmados pelo servidor.
   * Não lança: falha de rede mantém o lote na fila.
   */
  flush(): Promise<number>;
  /** Envia lotes até a fila esvaziar ou uma tentativa falhar. */
  flushAll(): Promise<number>;
  /** Eventos ainda não confirmados nesta sessão. */
  pending(): TelemetryQueuedEvent[];
  /** Último `seq` atribuído nesta sessão; 0 significa sessão ainda sem eventos. */
  lastSeq(): number;
  /** Nº de eventos descartados por fila cheia e ainda não reportados. */
  droppedCount(): number;
  /** `true` se o próximo `flush` deve esperar (backoff em curso). */
  isBackingOff(): boolean;
  /** Conteúdo de todas as sessões presentes neste navegador (cópia de segurança). */
  exportAllSessions(): Record<string, TelemetrySessionRecord>;
  /** Remove a fila desta sessão (usar só depois de exportar). */
  clearSession(): void;
}

const STORAGE_PREFIX = "pws:tutor:telemetry:v2:";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_QUEUED = 5000;
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
const SERVER_MAX_EVENTS_PER_BATCH = 500;

const EMPTY_RECORD: TelemetrySessionRecord = { lastSeq: 0, dropped: 0, events: [] };

function isPlainRecord(value: unknown): value is TelemetrySessionRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<TelemetrySessionRecord>;
  return typeof candidate.lastSeq === "number" && Array.isArray(candidate.events);
}

export function telemetryStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function createTelemetryQueue(options: CreateTelemetryQueueOptions): TelemetryQueue {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = `${base}/telemetry`;
  const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const storage = options.storage;
  const envelope = options.envelope;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, SERVER_MAX_EVENTS_PER_BATCH));
  const maxQueued = Math.max(batchSize, options.maxQueued ?? DEFAULT_MAX_QUEUED);
  const now = options.now ?? (() => new Date());
  const key = telemetryStorageKey(envelope.sessionId);

  let inFlight = false;
  let backoffMs = 0;
  let nextAttemptAt = 0;

  function read(): TelemetrySessionRecord {
    try {
      const raw = storage.getItem(key);
      if (!raw) {
        return { ...EMPTY_RECORD, events: [] };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) {
        return { ...EMPTY_RECORD, events: [] };
      }
      return {
        lastSeq: parsed.lastSeq,
        dropped: typeof parsed.dropped === "number" ? parsed.dropped : 0,
        events: parsed.events,
      };
    } catch {
      return { ...EMPTY_RECORD, events: [] };
    }
  }

  function write(record: TelemetrySessionRecord): boolean {
    try {
      storage.setItem(key, JSON.stringify(record));
      return true;
    } catch {
      // Quota excedida ou modo privado: o evento não pôde ser persistido.
      return false;
    }
  }

  function scheduleBackoff(): void {
    backoffMs = backoffMs === 0 ? MIN_BACKOFF_MS : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    nextAttemptAt = now().getTime() + backoffMs;
  }

  function clearBackoff(): void {
    backoffMs = 0;
    nextAttemptAt = 0;
  }

  /** Remove da fila os eventos já confirmados, sem perder o que entrou entretanto. */
  function dropConfirmed(confirmedSeqs: Set<number>, reportedDropped: number): void {
    const record = read();
    record.events = record.events.filter(event => !confirmedSeqs.has(event.seq));
    record.dropped = Math.max(0, record.dropped - reportedDropped);
    write(record);
  }

  async function postBatch(events: TelemetryQueuedEvent[], reportedDropped: number): Promise<number> {
    if (!fetchFn) {
      return 0;
    }

    const lastSeq = events.at(-1)?.seq ?? 0;
    const payload = {
      ...envelope,
      events:
        reportedDropped > 0
          ? [
              ...events,
              {
                type: "telemetry_dropped",
                seq: lastSeq,
                ts: now().toISOString(),
                droppedEvents: reportedDropped,
              },
            ]
          : events,
    };

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      scheduleBackoff();
      return 0;
    }

    if (response.ok) {
      clearBackoff();
      dropConfirmed(new Set(events.map(event => event.seq)), reportedDropped);
      return events.length;
    }

    // 413: lote grande demais — divide e tenta a metade.
    if (response.status === 413 && events.length > 1) {
      const half = Math.floor(events.length / 2);
      return postBatch(events.slice(0, half), reportedDropped);
    }

    // 400/413 irrecuperáveis: descarta para não bloquear a fila; a perda fica
    // registada no próprio dataset via `telemetry_dropped`.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      clearBackoff();
      dropConfirmed(new Set(events.map(event => event.seq)), 0);
      const record = read();
      record.dropped += events.length;
      write(record);
      return 0;
    }

    // 429/5xx (inclui 503 sem armazenamento configurado): mantém e recua.
    scheduleBackoff();
    return 0;
  }

  return {
    enqueue(event: TelemetryEventInput): TelemetryQueuedEvent | null {
      const record = read();

      if (record.events.length >= maxQueued) {
        record.dropped += 1;
        write(record);
        return null;
      }

      const queued: TelemetryQueuedEvent = {
        ...event,
        ts: typeof event.ts === "string" && event.ts ? event.ts : now().toISOString(),
        seq: record.lastSeq + 1,
      };

      record.lastSeq = queued.seq;
      record.events = [...record.events, queued];
      if (!write(record)) {
        return null;
      }
      return queued;
    },

    async flush(): Promise<number> {
      if (inFlight) {
        return 0;
      }
      if (nextAttemptAt > 0 && now().getTime() < nextAttemptAt) {
        return 0;
      }

      const record = read();
      if (record.events.length === 0) {
        return 0;
      }

      inFlight = true;
      try {
        return await postBatch(record.events.slice(0, batchSize), record.dropped);
      } finally {
        inFlight = false;
      }
    },

    async flushAll(): Promise<number> {
      let total = 0;
      for (;;) {
        const sent = await this.flush();
        if (sent === 0) {
          return total;
        }
        total += sent;
      }
    },

    pending(): TelemetryQueuedEvent[] {
      return read().events;
    },

    lastSeq(): number {
      return read().lastSeq;
    },

    droppedCount(): number {
      return read().dropped;
    },

    isBackingOff(): boolean {
      return nextAttemptAt > 0 && now().getTime() < nextAttemptAt;
    },

    exportAllSessions(): Record<string, TelemetrySessionRecord> {
      const out: Record<string, TelemetrySessionRecord> = {};
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (!storageKey?.startsWith(STORAGE_PREFIX)) {
          continue;
        }
        try {
          const parsed = JSON.parse(storage.getItem(storageKey) ?? "") as unknown;
          if (isPlainRecord(parsed)) {
            out[storageKey.slice(STORAGE_PREFIX.length)] = parsed;
          }
        } catch {
          /* ignora registo corrompido */
        }
      }
      return out;
    },

    clearSession(): void {
      try {
        storage.removeItem(key);
      } catch {
        /* ignora */
      }
    },
  };
}
