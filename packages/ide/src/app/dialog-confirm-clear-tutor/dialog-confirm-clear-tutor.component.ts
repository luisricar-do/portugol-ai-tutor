import { Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";

@Component({
  selector: "app-dialog-confirm-clear-tutor",
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Limpar conversa</h2>
    <mat-dialog-content>
      <p>Apagar todas as mensagens desta conversa com a ADA?</p>
      <p>Os destaques no código também serão removidos.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" mat-button [mat-dialog-close]="false">Cancelar</button>
      <button type="button" mat-button color="warn" [mat-dialog-close]="true">Apagar</button>
    </mat-dialog-actions>
  `,
})
export class DialogConfirmClearTutorComponent { }
