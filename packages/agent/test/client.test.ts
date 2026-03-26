import assert from "node:assert/strict";
import { test } from "node:test";

import { createTutorAgentClient } from "../src/client.js";
import type { EditorAction } from "../src/types.js";

test("helpStream chama onAction ao receber evento SSE action", async () => {
  const sse =
    'event: diagnosis\ndata: {"errorType":"none"}\n\n' +
    'event: action\ndata: {"type":"highlight_line","payload":{"line":14,"color":"warning"}}\n\n' +
    'event: done\ndata: {}\n\n';

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

  assert.deepStrictEqual(received, [
    { type: "highlight_line", payload: { line: 14, color: "warning" } },
  ]);
});
