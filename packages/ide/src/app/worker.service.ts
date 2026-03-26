import { Injectable } from "@angular/core";
import { PortugolCodeError } from "@luisricar-do/antlr";

@Injectable({ providedIn: "root" })
export class WorkerService {
  private checkWorker?: Worker;
  private transpileWorker?: Worker;
  busy = false;

  private static readonly CHECK_TIMEOUT_MS = 15000;
  private static readonly TRANSPILE_TIMEOUT_MS = 120000;

  /** Garante uma transpilação de cada vez (evita fila no worker + timeout falso). */
  private transpileTail: Promise<unknown> = Promise.resolve();

  private createWorker(): Worker {
    return new Worker("assets/portugol-worker/worker.js");
  }

  private ensureCheckWorker(): Worker {
    if (!this.checkWorker) {
      this.checkWorker = this.createWorker();
    }
    return this.checkWorker;
  }

  private ensureTranspileWorker(): Worker {
    if (!this.transpileWorker) {
      this.transpileWorker = this.createWorker();
    }
    return this.transpileWorker;
  }

  async checkCode(code: string): Promise<{
    errors: PortugolCodeError[];
    parseErrors: PortugolCodeError[];
  }> {
    const worker = this.ensureCheckWorker();
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 9);
      const now = Date.now();
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", listener);
        worker.removeEventListener("error", onError);
        reject(new Error("Timeout ao validar código no worker."));
      }, WorkerService.CHECK_TIMEOUT_MS);

      const listener = (e: MessageEvent) => {
        if (e.data.id === id) {
          console.log("Checker Result", e.data, `${Date.now() - now}ms`);
          clearTimeout(timeout);
          worker.removeEventListener("message", listener);
          worker.removeEventListener("error", onError);
          resolve(e.data);
        }
      };

      const onError = (event: ErrorEvent) => {
        clearTimeout(timeout);
        worker.removeEventListener("message", listener);
        worker.removeEventListener("error", onError);
        reject(event.error ?? new Error(event.message));
      };

      worker.addEventListener("message", listener);
      worker.addEventListener("error", onError);
      worker.postMessage({ code, id, action: "check" });
    });
  }

  async transpileCode(code: string): Promise<{
    js: string;
    errors: PortugolCodeError[];
    parseErrors: PortugolCodeError[];
    times: { parse: number; check: number; transpile: number };
  }> {
    const run = this.doTranspile(code);
    const next = this.transpileTail.then(() => run);
    this.transpileTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private doTranspile(code: string): Promise<{
    js: string;
    errors: PortugolCodeError[];
    parseErrors: PortugolCodeError[];
    times: { parse: number; check: number; transpile: number };
  }> {
    const worker = this.ensureTranspileWorker();
    this.busy = true;

    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 9);
      const now = Date.now();
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", listener);
        worker.removeEventListener("error", onError);
        this.busy = false;
        reject(new Error("Timeout ao transpilar código no worker."));
      }, WorkerService.TRANSPILE_TIMEOUT_MS);

      const listener = (e: MessageEvent) => {
        if (e.data.id === id) {
          console.log("Transpiler Result", e.data, `${Date.now() - now}ms`);
          clearTimeout(timeout);
          worker.removeEventListener("message", listener);
          worker.removeEventListener("error", onError);
          this.busy = false;
          resolve(e.data);
        }
      };

      const onError = (event: ErrorEvent) => {
        clearTimeout(timeout);
        worker.removeEventListener("message", listener);
        worker.removeEventListener("error", onError);
        this.busy = false;
        reject(event.error ?? new Error(event.message));
      };

      worker.addEventListener("message", listener);
      worker.addEventListener("error", onError);
      worker.postMessage({ code, id, action: "transpile" });
    });
  }

  abortTranspilation() {
    if (this.transpileWorker && this.busy) {
      this.transpileWorker.terminate();
      this.transpileWorker = undefined;
      this.busy = false;
      this.transpileTail = Promise.resolve();
    }
  }
}
