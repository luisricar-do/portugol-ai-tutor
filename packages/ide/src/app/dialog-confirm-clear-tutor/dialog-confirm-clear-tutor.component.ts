import { DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

/**
 *  *  * `id` do título, passado como `ariaLabelledBy` a quem abre o diálogo.
 */
export const DIALOG_CONFIRM_CLEAR_TUTOR_TITLE_ID = "dialogo-limpar-tutor-titulo";

/**
 * Confirma apagar a conversa com a ADA. Fecha com `true` para apagar; `false`
 * (Cancelar) ou `undefined` (Esc, clique fora) mantêm a conversa.
 */
@Component({
  selector: "app-dialog-confirm-clear-tutor",
  templateUrl: "./dialog-confirm-clear-tutor.component.html",
  styleUrl: "./dialog-confirm-clear-tutor.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogConfirmClearTutorComponent {
  readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
}
