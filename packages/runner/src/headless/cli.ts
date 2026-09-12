/**
 * CLI do executor headless: lê JSON em stdin, escreve JSON em stdout.
 *
 * Entrada: `{ "code": "...", "stdin": ["3", "4"], "timeoutMs": 5000 }` — ou uma lista desses
 * objetos, executados em ordem (um estado de código por entrada).
 *
 * Uso: `node lib/headless/cli.js < entrada.json`
 */
import { inspect } from "node:util";

import { runPortugolProgram, type HeadlessRunOptions, type HeadlessRunResult } from "./runProgram.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * O verificador e o transpilador escrevem diagnósticos com `console.*`; em stdout eles
 * corromperiam o JSON do resultado, então vão todos para stderr.
 */
function routeConsoleToStderr(): void {
  // `inspect` em vez de `JSON.stringify`: o transpilador loga nós do ANTLR, que são cíclicos —
  // serializá-los lançaria dentro do próprio verificador e viraria um falso erro de compilação.
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(
      `${args.map(arg => (typeof arg === "string" ? arg : inspect(arg, { depth: 1 }))).join(" ")}\n`,
    );
  };

  console.log = toStderr;
  console.debug = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
}

async function main(): Promise<void> {
  routeConsoleToStderr();

  const raw = (await readStdin()).trim();

  if (!raw) {
    process.stderr.write("Nada em stdin: envie um objeto JSON com 'code'.\n");
    process.exitCode = 2;
    return;
  }

  const parsed: unknown = JSON.parse(raw);
  const jobs: HeadlessRunOptions[] = Array.isArray(parsed) ? parsed : [parsed as HeadlessRunOptions];
  const results: HeadlessRunResult[] = [];

  for (const job of jobs) {
    results.push(await runPortugolProgram(job));
  }

  process.stdout.write(`${JSON.stringify(Array.isArray(parsed) ? results : results[0], undefined, 2)}\n`);
}

await main();
