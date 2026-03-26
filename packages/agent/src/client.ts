import type {
  EditorAction,
  TutorDiagnosis,
  TutorHelpErrorBody,
  TutorHelpRequest,
  TutorHelpResponse,
  TutorHelpStreamHandlers,
} from "./types.js";

/** Código mínimo quando não há fonte do editor — exige campo não vazio na API. */
export const TUTOR_CHAT_PLACEHOLDER_CODE = "// (sem código do editor — conversa de exemplo)\nprograma\n{\n}\n";

export class TutorAgentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TutorAgentError";
  }
}

export function normalizeAgentBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

interface SseStreamState {
  sawDone: boolean;
  sawError: boolean;
}

/** Executa `fn` dentro do runner opcional (ex.: NgZone.run no Angular). */
function runInZoneOptional(runInZone: ((fn: () => void) => void) | undefined, fn: () => void): void {
  if (runInZone) {
    runInZone(fn);
  } else {
    fn();
  }
}

function dispatchSseBlock(
  block: string,
  handlers: TutorHelpStreamHandlers,
  state: SseStreamState,
  runInZone: ((fn: () => void) => void) | undefined,
): void {
  let eventName = "";
  let dataLine = "";
  for (const line of block.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLine = trimmed.slice(5).trimStart();
    }
  }

  if (!dataLine) {
    return;
  }

  runInZoneOptional(runInZone, () => {
    let data: unknown;
    try {
      data = JSON.parse(dataLine) as unknown;
    } catch {
      state.sawError = true;
      handlers.onError?.(500, "Evento SSE com JSON inválido.");
      return;
    }

    switch (eventName) {
      case "diagnosis": {
        handlers.onDiagnosis?.(data as TutorDiagnosis);
        break;
      }

      case "token": {
        const text = (data as { text?: string }).text ?? "";
        handlers.onToken?.(text);
        break;
      }

      case "action": {
        const action = data as EditorAction;
        handlers.onAction?.(action);
        break;
      }

      case "done": {
        state.sawDone = true;
        handlers.onDone?.();
        break;
      }

      case "error": {
        state.sawError = true;
        const err = data as { status?: number; error?: string };
        const status = err.status ?? 500;
        const message = err.error ?? "Erro no stream.";
        handlers.onError?.(status, message);
        break;
      }

      default: {
        break;
      }
    }
  });
}

async function readHelpSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: TutorHelpStreamHandlers,
  runInZone: ((fn: () => void) => void) | undefined,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  const streamState: SseStreamState = { sawDone: false, sawError: false };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        carry += decoder.decode();
        break;
      }

      carry += decoder.decode(value, { stream: true });
      const parts = carry.split("\n\n");
      carry = parts.pop() ?? "";

      for (const rawBlock of parts) {
        const block = rawBlock.trim();
        if (!block) {
          continue;
        }

        dispatchSseBlock(block, handlers, streamState, runInZone);
      }
    }

    if (carry.trim()) {
      dispatchSseBlock(carry.trim(), handlers, streamState, runInZone);
    }
  } finally {
    reader.releaseLock();
  }

  if (!streamState.sawDone && !streamState.sawError) {
    runInZoneOptional(runInZone, () => handlers.onDone?.());
  }
}

export interface TutorAgentClient {
  help(body: TutorHelpRequest): Promise<TutorHelpResponse>;
  /**
   * Consome `POST {baseUrl}/help/stream` (``text/event-stream``).
   * Resolve após o stream terminar; rejeita com ``TutorAgentError`` em falha de rede ou evento ``error``.
   */
  helpStream(
    body: TutorHelpRequest,
    handlers: TutorHelpStreamHandlers,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface CreateTutorAgentClientOptions {
  /** Ex.: `http://localhost:7071/api` (Azure Functions). */
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Garante que os callbacks do SSE corram na zona do UI (ex.: `NgZone.run`).
   * Necessário com Angular + streams: `ReadableStream` pode retomar fora da zona.
   */
  runInZone?: (fn: () => void) => void;
}

export function createTutorAgentClient(options: CreateTutorAgentClientOptions): TutorAgentClient {
  const base = normalizeAgentBaseUrl(options.baseUrl);
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const runInZone = options.runInZone;

  return {
    async help(body: TutorHelpRequest): Promise<TutorHelpResponse> {
      const url = `${base}/help`;
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new TutorAgentError(response.status, "Resposta inválida do servidor (não é JSON).");
      }

      if (!response.ok) {
        const err = (data as TutorHelpErrorBody).error ?? `HTTP ${response.status}`;
        throw new TutorAgentError(response.status, err);
      }

      return data as TutorHelpResponse;
    },

    async helpStream(
      body: TutorHelpRequest,
      handlers: TutorHelpStreamHandlers,
      options?: { signal?: AbortSignal },
    ): Promise<void> {
      const url = `${base}/help/stream`;
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (!response.body) {
        throw new TutorAgentError(response.status, "Resposta sem corpo (stream não disponível).");
      }

      if (!response.ok && !contentType.includes("text/event-stream")) {
        let message = `HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as TutorHelpErrorBody;
          message = errJson.error ?? message;
        } catch {
          /* ignore */
        }

        throw new TutorAgentError(response.status, message);
      }

      const streamError: { current: TutorAgentError | null } = { current: null };

      await readHelpSseStream(
        response.body,
        {
          onDiagnosis: handlers.onDiagnosis,
          onToken: handlers.onToken,
          onDone: handlers.onDone,
          onAction: handlers.onAction,
          onError: (status, message) => {
            handlers.onError?.(status, message);
            streamError.current = new TutorAgentError(status, message);
          },
        },
        runInZone,
      );

      if (streamError.current !== null) {
        throw streamError.current;
      }
    },
  };
}
