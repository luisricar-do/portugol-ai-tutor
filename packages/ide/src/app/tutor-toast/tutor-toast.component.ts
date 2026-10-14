import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { HotToastRef } from "@ngxpert/hot-toast";

/**
 * Tom do aviso. `celebrate` e `escalate` correspondem às antigas classes
 * `tutor-snack--celebrate` / `tutor-snack--escalate` (ainda postas no aviso,
 * para quem estiliza por elas).
 */
export type TutorToastVariant = "plain" | "nudge" | "celebrate" | "escalate";

export interface TutorToastData {
  message: string;
  variant: TutorToastVariant;
}

/**
 *  * Aviso do tutor com o botão "OK", como o snackbar do Material que ele substitui.
 */
@Component({
  selector: "app-tutor-toast",
  templateUrl: "./tutor-toast.component.html",
  styleUrl: "./tutor-toast.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "[class]": "'tutor-toast tutor-toast--' + toastRef.data.variant" },
})
export class TutorToastComponent {
  readonly toastRef = inject<HotToastRef<TutorToastData>>(HotToastRef);

  dismiss(): void {
    this.toastRef.close({ dismissedByAction: true });
  }
}
