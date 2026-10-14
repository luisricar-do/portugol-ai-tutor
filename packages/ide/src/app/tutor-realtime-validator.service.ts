import { Service, inject } from "@angular/core";
import { TutorImmersionService } from "./tutor-immersion.service";
import { TutorToastService } from "./tutor-toast.service";

/**
 * Validação leve em tempo real: quando há variável “quebrada” no mapa de fluxo,
 * reanalisa erros do worker; se os erros sumiram ou não mencionam a variável, dissolve o modo foco.
 */
@Service()
export class TutorRealtimeValidatorService {
  private readonly immersion = inject(TutorImmersionService);
  private readonly toast = inject(TutorToastService);

  /**
   *  *  * Chamado após checkCode (debounced) na aba ativa.
   */
  onErrorsUpdated(errorsText: string[]): void {
    const pending = this.immersion.pendingBrokenVar();
    if (!pending) {
      return;
    }

    const varLower = pending.toLowerCase();
    const stillBroken = errorsText.some(line => {
      return (
        line.toLowerCase().includes(varLower) ||
        line.toLowerCase().includes("não inicializ") ||
        line.toLowerCase().includes("nao inicializ")
      );
    });

    if (!stillBroken) {
      this.immersion.resolvePendingFlow();
      this.toast.show("Fluxo completo — pode executar de novo quando quiser.", {
        duration: 5000,
        variant: "celebrate",
      });
    }
  }
}
