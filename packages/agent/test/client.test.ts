import assert from "node:assert/strict";
import { test } from "vitest";

import { createTutorAgentClient } from "../src/client.js";
import type { EditorAction } from "../src/types.js";

test("helpStream chama onAction ao receber evento SSE action", async () => {
  const sse =
    'event: diagnosis\ndata: {"errorType":"none"}\n\n' +
    'event: action\ndata: {"type":"highlight_line","payload":{"line":14,"color":"warning"}}\n\n' +
    "event: done\ndata: {}\n\n";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });

  const fetchMock: typeof fetch = async () =>
    new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });

  const received: EditorAction[] = [];
  const client = createTutorAgentClient({ baseUrl: "http://localhost:7071/api", fetch: fetchMock });

  await client.helpStream(
    { code: "programa\n{\n}", errors: [], history: [] },
    {
      onAction: action => {
        received.push(action);
      },
    },
  );

  assert.deepStrictEqual(received, [{ type: "highlight_line", payload: { line: 14, color: "warning" } }]);
});

test("helpStream passa tutorMeta no onDone quando o evento done inclui JSON", async () => {
  const sse =
    'event: diagnosis\ndata: {"errorType":"none"}\n\n' +
    'event: done\ndata: {"tutorMeta":{"suggestedConversationEnd":true,"endReason":"bug_resolved"}}\n\n';

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });

  const fetchMock: typeof fetch = async () =>
    new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });

  let donePayload: unknown;
  const client = createTutorAgentClient({ baseUrl: "http://localhost:7071/api", fetch: fetchMock });

  await client.helpStream(
    { code: "programa\n{\n}", errors: [], history: [] },
    {
      onDone: payload => {
        donePayload = payload;
      },
    },
  );

  assert.deepStrictEqual(donePayload, {
    tutorMeta: { suggestedConversationEnd: true, endReason: "bug_resolved" },
  });
});

test("helpStream envia o concretenessLevel dos turnos assistant no history", async () => {
  let sentBody: unknown;
  const fetchMock: typeof fetch = async (_url, init) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: done\ndata: {}\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
    );
  };
  const client = createTutorAgentClient({ baseUrl: "http://localhost:7071/api", fetch: fetchMock });

  const history = [
    { role: "user" as const, content: "não sei", code: "x", errors: [] },
    { role: "assistant" as const, content: "Olhe a linha 2.", concretenessLevel: 1 },
    { role: "user" as const, content: "ainda não", code: "x", errors: [] },
  ];
  await client.helpStream({ code: "x", errors: [], history }, {});

  assert.deepStrictEqual((sentBody as { history: unknown }).history, history);
});
