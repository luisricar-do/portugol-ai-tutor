import { PortugolJsRuntime } from "@luisricar-do/runtime";
import { Worker } from "node:worker_threads";
import { Subject, Subscription } from "rxjs";

import { IPortugolRunner, PortugolEvent, PortugolMessage } from "./IPortugolRunner.js";
import { buildProgramBootstrap } from "./programBootstrap.js";

/**
 * Ponte entre o protocolo de Web Worker esperado pelo runtime do Portugol (`self.postMessage`,
 * `self.addEventListener("message")`) e o `parentPort` de `worker_threads`.
 */
const SELF_SHIM = /* javascript */ `
  const { parentPort } = require("node:worker_threads");

  globalThis.self = globalThis.self ?? {};
  self.postMessage = data => parentPort.postMessage(data);
  self.addEventListener = (type, listener, options = {}) => {
    if (type !== "message") {
      return;
    }

    const wrapper = data => {
      if (options.signal?.aborted) {
        parentPort.off("message", wrapper);
        return;
      }

      if (options.once) {
        parentPort.off("message", wrapper);
      }

      listener({ data });
    };

    parentPort.on("message", wrapper);
    options.signal?.addEventListener?.("abort", () => parentPort.off("message", wrapper), { once: true });
  };
`;

/**
 * Executa o programa transpilado fora do navegador, num worker de Node.
 *
 * Existe para a avaliação da dissertação: permite compilar cada estado de código do banco de
 * itens e rodar os casos de teste sem abrir a IDE — é o que sustenta a classificação objetiva do
 * movimento do estudante (progresso, estagnação, regressão) e os erros de compilação
 * pré-computados. A semântica de execução é a mesma do navegador: o mesmo runtime e o mesmo
 * bootstrap (`buildProgramBootstrap`).
 */
export class PortugolNodeRunner extends IPortugolRunner {
  private worker: Worker;

  stdIn = new Subject<string>();
  private _stdIn$?: Subscription;

  stdOut$ = new Subject<string>();

  waitingForInput = false;
  waitingForInput$ = new Subject<boolean>();

  running = false;
  running$ = new Subject<boolean>();

  startedAt?: Date;

  private _run = new Subject<PortugolEvent>();
  private destroyed = false;

  constructor(public byteCode: string) {
    super(byteCode);

    this.worker = new Worker([SELF_SHIM, PortugolJsRuntime, buildProgramBootstrap(this.byteCode)].join("\n"), {
      eval: true,
      stdout: true,
      stderr: true,
    });

    this.worker.on(
      "message",
      (data: {
        type: string;
        content?: string;
        error?: { message: string; stack?: string };
        message?: PortugolMessage;
      }) => {
        switch (data.type) {
          case "stdOut": {
            this.stdOut$.next(data.content ?? "");
            break;
          }

          case "stdIn": {
            this.waitingForInput = true;
            this.waitingForInput$.next(this.waitingForInput);
            this._run.next({ type: "stdIn" });
            break;
          }

          case "error": {
            const error = new Error(data.error?.message ?? "Erro desconhecido");

            error.stack = data.error?.stack;
            this._run.next({ type: "error", error });
            this.destroy();
            break;
          }

          case "clear": {
            this._run.next({ type: "clear" });
            break;
          }

          case "finish": {
            this.destroy();
            break;
          }

          case "message": {
            if (data.message) {
              this._run.next({ type: "message", message: data.message });
            }

            break;
          }

          default: {
            break;
          }
        }
      },
    );

    this.worker.on("error", (error: unknown) => {
      this._run.next({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this.destroy();
    });

    this._stdIn$ = this.stdIn.subscribe(content => {
      if (this.waitingForInput) {
        this.waitingForInput = false;
        this.waitingForInput$.next(this.waitingForInput);
        this.worker.postMessage({ type: "stdIn", content });
      }
    });
  }

  run() {
    this.startedAt = new Date();
    this.worker.postMessage({ type: "start" });

    this.running = true;
    this.running$.next(this.running);

    return this._run;
  }

  destroy(stopped = false) {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    void this.worker.terminate();

    this._run.next({
      type: "finish",
      time: Date.now() - (this.startedAt?.getTime() ?? 0),
      stopped,
    });
    this._run.complete();

    this.running = false;
    this.running$.next(false);
    this.running$.complete();

    this._stdIn$?.unsubscribe();
    this.stdIn.complete();
  }

  postMessage(message: PortugolMessage) {
    if (!Object.hasOwn(message, "id")) {
      message.id = Math.random().toString(36).slice(2, 11);
    }

    this.worker.postMessage({ type: "message", message });
  }

  replyMessage(message: PortugolMessage, result: unknown) {
    if (!Object.hasOwn(message, "id")) {
      throw new Error("Não é possível responder uma mensagem sem identificador!");
    }

    this.worker.postMessage({ type: "message-reply", id: message.id, result });
  }
}
