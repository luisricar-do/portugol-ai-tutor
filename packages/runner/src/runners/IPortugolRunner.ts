import { IPortugolCodeDiagnostic } from "@luisricar-do/antlr";
import { Observable, Subject } from "rxjs";

export type PortugolEvent =
  | { type: "start" }
  | { type: "clear" }
  | { type: "stdIn" }
  | { type: "error"; error: Error }
  | { type: "parseError"; errors: IPortugolCodeDiagnostic[] }
  /**
  `outputLimit`: o executor interrompeu o programa porque a saída passou do teto.
  */
  | { type: "finish"; stopped: boolean; time: number; outputLimit?: boolean }
  | { type: "message"; message: PortugolMessage };

export type PortugolMessage = {
  id?: string;
  type: string;
  data?: unknown;
};

export abstract class IPortugolRunner {
  constructor(public byteCode: string) {}

  abstract stdIn: Subject<string>;
  abstract stdOut$: Observable<string>;

  abstract waitingForInput: boolean;
  abstract waitingForInput$: Observable<boolean>;

  abstract running: boolean;
  abstract running$: Observable<boolean>;

  abstract run(): Observable<PortugolEvent>;
  abstract destroy(stopped?: boolean): void;

  abstract postMessage(message: PortugolMessage): void;
  abstract replyMessage(message: PortugolMessage, result: unknown, transferable?: Transferable[]): void;
}
