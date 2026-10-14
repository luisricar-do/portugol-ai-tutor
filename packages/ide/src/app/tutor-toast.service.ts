import { Service, inject } from "@angular/core";
import { CreateHotToastRef, HotToastService } from "@ngxpert/hot-toast";

import { TutorToastComponent, type TutorToastData, type TutorToastVariant } from "./tutor-toast/tutor-toast.component";

/**
 * Avisos curtos do tutor (antes, o snackbar do Material). Como no snackbar, só um aviso do
 * tutor fica aberto: o novo substitui o anterior.
 */
@Service()
export class TutorToastService {
  private readonly toast = inject(HotToastService);

  private current: CreateHotToastRef<unknown> | null = null;

  show(message: string, options: { duration: number; variant?: TutorToastVariant }): void {
    const variant = options.variant ?? "plain";

    this.current?.close();
    const ref = this.toast.show<TutorToastData>(TutorToastComponent, {
      data: { message, variant },
      duration: options.duration,
      ariaLive: "polite",
      className: variant === "plain" ? "tutor-snack" : `tutor-snack tutor-snack--${variant}`,
    });
    this.current = ref;
    ref.afterClosed.subscribe(() => {
      if (this.current === ref) {
        this.current = null;
      }
    });
  }
}
