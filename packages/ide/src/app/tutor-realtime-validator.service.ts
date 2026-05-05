import { Injectable, inject } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import { TutorImmersionService } from "./tutor-immersion.service";

/**
 * Validação leve em tempo real: quando há variável “quebrada” no mapa de fluxo,
 * reanalisa erros do worker; se os erros sumiram ou não mencionam a variável, dissolve o modo foco.
 */
@Injectable({ providedIn: "root" })
export class TutorRealtimeValidatorService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly snack = inject(MatSnackBar);

  /** Chamado após checkCode (debounced) na aba ativa. */
  onErrorsUpdated(errorsText: string[]): void {
    const pending = this.immersion.pendingBrokenVar();
    if (!pending) {
      return;
    }

    const varLower = pending.toLowerCase();
    const stillBroken = errorsText.some(
      line =>
        line.toLowerCase().includes(varLower) ||
        line.toLowerCase().includes("não inicializ") ||
        line.toLowerCase().includes("nao inicializ"),
    );

    if (!stillBroken) {
      this.immersion.resolvePendingFlow();
      this.snack.open("Fluxo completo — pode executar de novo quando quiser.", "OK", {
        duration: 5000,
        panelClass: ["tutor-snack", "tutor-snack--celebrate"],
      });
    }
  }
}
