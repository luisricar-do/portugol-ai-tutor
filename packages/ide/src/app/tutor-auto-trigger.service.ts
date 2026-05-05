import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

/**
 * Dispara uma mensagem automática no chat do tutor (ex.: após erro de execução).
 */
@Injectable({ providedIn: "root" })
export class TutorAutoTriggerService {
  private readonly subject = new Subject<string>();

  readonly events$ = this.subject.asObservable();

  emitUserMessage(text: string): void {
    this.subject.next(text);
  }
}
