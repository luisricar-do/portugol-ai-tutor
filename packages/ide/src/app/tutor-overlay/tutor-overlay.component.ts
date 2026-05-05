import { Component, HostListener, Injector, afterNextRender, effect, inject, viewChild } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { AngularSvgIconModule } from "angular-svg-icon";

import { AgentChatComponent } from "../agent-chat/agent-chat.component";
import { TutorEditorContextService } from "../tutor-editor-context.service";
import { TutorOverlayService } from "../tutor-overlay.service";

@Component({
  selector: "app-tutor-overlay",
  standalone: true,
  imports: [AgentChatComponent, AngularSvgIconModule, MatButtonModule],
  templateUrl: "./tutor-overlay.component.html",
  styleUrl: "./tutor-overlay.component.scss",
})
export class TutorOverlayComponent {
  private readonly tutorContext = inject(TutorEditorContextService);
  readonly shell = inject(TutorOverlayService);
  private readonly injector = inject(Injector);

  readonly agentChat = viewChild(AgentChatComponent);

  constructor() {
    effect(() => {
      if (!this.shell.isOpen()) {
        return;
      }
      afterNextRender(
        () => {
          this.agentChat()?.focusComposer();
        },
        { injector: this.injector },
      );
    });
  }

  activeContext(): ReturnType<TutorEditorContextService["getActive"]> {
    return this.tutorContext.getActive();
  }

  readonly cursorLineResolver = (): number | undefined => this.tutorContext.getActive()?.getCursorLine?.() ?? undefined;

  readonly cursorColumnResolver = (): number | undefined =>
    this.tutorContext.getActive()?.getCursorColumn?.() ?? undefined;

  readonly astSummaryResolver = (): string | undefined => this.tutorContext.getActive()?.getAstSummary?.() ?? undefined;

  readonly dataFlowContextResolver = (): string | undefined =>
    this.tutorContext.getActive()?.getDataFlowContext?.() ?? undefined;

  close(): void {
    this.shell.hide();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.shell.isOpen()) {
      this.close();
    }
  }
}
