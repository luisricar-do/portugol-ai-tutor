import assert from "node:assert/strict";
import { test } from "node:test";

import { createTelemetryQueue, telemetryStorageKey } from "../src/telemetry.js";
import type { TelemetryStorage } from "../src/telemetry.js";

class FakeStorage implements TelemetryStorage {
  private readonly map = new Map<string, string>();
  /** Simula quota esgotada quando `true`. */
  failWrites = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error("QuotaExceededError");
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

interface FakeClock {
  now: () => Date;
  advance: (ms: number) => void;
}

function fakeClock(startMs = 1_700_000_000_000): FakeClock {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const MIN_BACKOFF_MS = 2000;

const ENVELOPE = {
  installId: "inst-abc",
  sessionId: "sess-1",
  participantId: "P07",
  condition: "experimental",
  buildSha: "cafe1234",
};

function makeQueue(
  overrides: Partial<Parameters<typeof createTelemetryQueue>[0]> = {},
  storage = new FakeStorage(),
  clock = fakeClock(),
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const queue = createTelemetryQueue({
    baseUrl: "http://localhost:7071/api/",
    envelope: ENVELOPE,
    storage,
    fetch: fetchMock,
    now: clock.now,
    ...overrides,
  });

  return { queue, storage, clock, calls };
}

test("enqueue persiste com seq monotónico e ts ISO", () => {
  const { queue, storage } = makeQueue();

  const first = queue.enqueue({ type: "session_start" });
  const second = queue.enqueue({ type: "code_edit" });

  assert.equal(first?.seq, 1);
  assert.equal(second?.seq, 2);
  assert.match(first!.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(queue.pending().length, 2);
  assert.ok(storage.getItem(telemetryStorageKey("sess-1")));
});

test("seq continua depois de recarregar a página (mesmo storage)", () => {
  const storage = new FakeStorage();
  makeQueue({}, storage).queue.enqueue({ type: "session_start" });

  const reopened = makeQueue({}, storage).queue;
  assert.equal(reopened.enqueue({ type: "compile" })?.seq, 2);
  assert.equal(reopened.pending().length, 2);
});

test("enqueue respeita ts fornecido pelo chamador", () => {
  const { queue } = makeQueue();
  const event = queue.enqueue({ type: "compile", ts: "2026-08-22T10:00:00.000Z" });
  assert.equal(event?.ts, "2026-08-22T10:00:00.000Z");
});

test("flush envia o envelope e limpa os eventos confirmados", async () => {
  const { queue, calls } = makeQueue();
  queue.enqueue({ type: "session_start" });
  queue.enqueue({ type: "code_edit" });

  const sent = await queue.flush();

  assert.equal(sent, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:7071/api/telemetry");
  assert.equal(calls[0].body.installId, "inst-abc");
  assert.equal(calls[0].body.sessionId, "sess-1");
  assert.equal(calls[0].body.participantId, "P07");
  assert.equal((calls[0].body.events as unknown[]).length, 2);
  assert.equal(queue.pending().length, 0);
});

test("flush respeita batchSize e flushAll drena a fila", async () => {
  const { queue, calls } = makeQueue({ batchSize: 2 });
  for (let i = 0; i < 5; i += 1) {
    queue.enqueue({ type: "code_edit" });
  }

  assert.equal(await queue.flush(), 2);
  assert.equal(queue.pending().length, 3);

  assert.equal(await queue.flushAll(), 3);
  assert.equal(queue.pending().length, 0);
  assert.equal(calls.length, 3);
});

test("falha de rede mantém os eventos na fila e aplica backoff", async () => {
  const clock = fakeClock();
  const fetchMock: typeof fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const { queue } = makeQueue({ fetch: fetchMock }, new FakeStorage(), clock);
  queue.enqueue({ type: "session_start" });

  assert.equal(await queue.flush(), 0);
  assert.equal(queue.pending().length, 1);
  assert.equal(queue.isBackingOff(), true);

  // Dentro do backoff não há nova tentativa.
  assert.equal(await queue.flush(), 0);
  clock.advance(2000);
  assert.equal(queue.isBackingOff(), false);
});

test("503 (armazenamento não configurado) preserva os eventos", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "não configurado" }), { status: 503 });
  const { queue } = makeQueue({ fetch: fetchMock });
  queue.enqueue({ type: "session_start" });

  assert.equal(await queue.flush(), 0);
  assert.equal(queue.pending().length, 1);
});

test("eventos recuperam depois de o servidor voltar", async () => {
  const clock = fakeClock();
  let fail = true;
  const fetchMock: typeof fetch = async () =>
    fail ? new Response("{}", { status: 500 }) : new Response("{}", { status: 200 });
  const { queue } = makeQueue({ fetch: fetchMock }, new FakeStorage(), clock);
  queue.enqueue({ type: "session_start" });

  assert.equal(await queue.flush(), 0);
  fail = false;
  clock.advance(MIN_BACKOFF_MS);
  assert.equal(await queue.flush(), 1);
  assert.equal(queue.pending().length, 0);
});
test("413 divide o lote em vez de o perder", async () => {
  const statuses: number[] = [];
  const sizes: number[] = [];
  const fetchMock: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { events: unknown[] };
    sizes.push(body.events.length);
    const status = body.events.length > 2 ? 413 : 200;
    statuses.push(status);
    return new Response("{}", { status });
  };
  const { queue } = makeQueue({ fetch: fetchMock, batchSize: 4 });
  for (let i = 0; i < 4; i += 1) {
    queue.enqueue({ type: "code_edit" });
  }

  const sent = await queue.flush();
  assert.deepEqual(sizes, [4, 2]);
  assert.deepEqual(statuses, [413, 200]);
  assert.equal(sent, 2);
  assert.equal(queue.pending().length, 2);
});

test("400 descarta o lote mas contabiliza a perda", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "installId inválido" }), { status: 400 });
  const { queue } = makeQueue({ fetch: fetchMock });
  queue.enqueue({ type: "session_start" });

  assert.equal(await queue.flush(), 0);
  assert.equal(queue.pending().length, 0);
  assert.equal(queue.droppedCount(), 1);
});

test("perda por fila cheia é reportada como evento telemetry_dropped", async () => {
  const { queue, calls } = makeQueue({ maxQueued: 1, batchSize: 1 });
  queue.enqueue({ type: "session_start" });
  assert.equal(queue.enqueue({ type: "code_edit" }), null);
  assert.equal(queue.droppedCount(), 1);

  await queue.flush();

  const events = calls[0].body.events as { type: string; droppedEvents?: number }[];
  assert.equal(events.length, 2);
  assert.equal(events[1].type, "telemetry_dropped");
  assert.equal(events[1].droppedEvents, 1);
  assert.equal(queue.droppedCount(), 0);
});

test("storage indisponível não lança e sinaliza a perda", () => {
  const storage = new FakeStorage();
  storage.failWrites = true;
  const { queue } = makeQueue({}, storage);

  assert.equal(queue.enqueue({ type: "session_start" }), null);
  assert.equal(queue.pending().length, 0);
});

test("registo corrompido no storage não impede novos eventos", () => {
  const storage = new FakeStorage();
  storage.setItem(telemetryStorageKey("sess-1"), "{ isto não é json");
  const { queue } = makeQueue({}, storage);

  assert.equal(queue.enqueue({ type: "session_start" })?.seq, 1);
});

test("exportAllSessions devolve todas as sessões do navegador", () => {
  const storage = new FakeStorage();
  makeQueue({}, storage).queue.enqueue({ type: "session_start" });
  createTelemetryQueue({
    baseUrl: "http://x/api",
    envelope: { ...ENVELOPE, sessionId: "sess-2" },
    storage,
    fetch: async () => new Response("{}", { status: 200 }),
  }).enqueue({ type: "session_start" });
  storage.setItem("outra:chave", "não deve aparecer");

  const exported = makeQueue({}, storage).queue.exportAllSessions();
  assert.deepEqual(Object.keys(exported).sort(), ["sess-1", "sess-2"]);
  assert.equal(exported["sess-1"].events.length, 1);
});

test("clearSession remove apenas a sessão corrente", () => {
  const storage = new FakeStorage();
  const { queue } = makeQueue({}, storage);
  queue.enqueue({ type: "session_start" });
  storage.setItem(telemetryStorageKey("sess-2"), JSON.stringify({ lastSeq: 1, dropped: 0, events: [] }));

  queue.clearSession();

  assert.equal(queue.pending().length, 0);
  assert.ok(storage.getItem(telemetryStorageKey("sess-2")));
});

test("flush concorrente não duplica o lote", async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response("{}", { status: 200 });
  };
  const { queue } = makeQueue({ fetch: fetchMock });
  queue.enqueue({ type: "session_start" });

  const [a, b] = await Promise.all([queue.flush(), queue.flush()]);

  assert.equal(calls, 1);
  assert.equal(a + b, 1);
  assert.equal(queue.pending().length, 0);
});

test("lastSeq distingue sessão nova de recarregamento", () => {
  const storage = new FakeStorage();
  assert.equal(makeQueue({}, storage).queue.lastSeq(), 0);

  makeQueue({}, storage).queue.enqueue({ type: "session_start" });
  assert.equal(makeQueue({}, storage).queue.lastSeq(), 1);
});

test("lastSeq não recua ao confirmar eventos", async () => {
  const { queue } = makeQueue();
  queue.enqueue({ type: "session_start" });
  queue.enqueue({ type: "code_edit" });
  await queue.flush();

  assert.equal(queue.pending().length, 0);
  assert.equal(queue.lastSeq(), 2);
});
