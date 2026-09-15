import { Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";

@Component({
  selector: "app-dialog-confirm-clear-tutor",
  imports: [MatDialogModule, MatButtonModule],
  standalone: true,
  templateUrl: "./dialog-confirm-clear-tutor.component.html",
})
export class DialogConfirmClearTutorComponent {}
