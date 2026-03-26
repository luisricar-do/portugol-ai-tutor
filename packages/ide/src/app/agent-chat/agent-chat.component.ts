import { JsonPipe } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Injector,
  Input,
  NgZone,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import {
  createTutorAgentClient,
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError,
  type TutorDiagnosis,
  type TutorHistoryItem,
} from "@luisricar-do/agent";
import { AngularSvgIconModule } from "angular-svg-icon";

import { environment } from "../../environments/environment";
import { EditorActionsService } from "../editor-actions.service";

@Component({
  selector: "app-agent-chat",
  imports: [AngularSvgIconModule, FormsModule, JsonPipe, MatButtonModule, MatCheckboxModule],
  standalone: true,
  templateUrl: "./agent-chat.component.html",
  styleUrl: "./agent-chat.component.scss",
})
export class AgentChatComponent {
  /** Valor espelhado do editor (pode atrasar face ao Monaco). */
  @Input() editorCode = "";

  /**
   * Se definido, o texto enviado ao tutor usa o retorno desta função no momento do envio
   * (ex.: `getModel().getValue()`), garantindo o código atualmente aberto no editor.
   */
  @Input() editorCodeSnapshot?: () => string;

  /**
   * Erros do compilador no momento do envio (ex.: `checkCode` no worker).
   * Se não existir, usa `compilerErrorsSnapshot` quando definido.
   */
  @Input() compilerErrorsResolver?: () => Promise<string[]>;

  /** Fallback síncrono (ex.: marcadores Monaco) quando não há resolver. */
  @Input() compilerErrorsSnapshot?: () => string[];

  readonly baseUrlConfigured = Boolean(environment.agentApiBaseUrl?.trim());

  readonly scrollArea = viewChild<ElementRef<HTMLElement>>("scrollArea");

  readonly threadEnd = viewChild<ElementRef<HTMLElement>>("threadEnd");

  private readonly ngZone = inject(NgZone);

  private readonly injector = inject(Injector);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly editorActionsService = inject(EditorActionsService);

  draft = "";
  error: string | null = null;
  showDiagnosis = false;
  lastDiagnosis: TutorDiagnosis | null = null;

  /** Resposta em andamento via SSE (`/help/stream`). */
  streamingAssistant = false;
  streamingText = "";

  private history: TutorHistoryItem[] = [];

  get thread(): TutorHistoryItem[] {
    return this.history;
  }

  get hasHistory(): boolean {
    return this.history.length > 0;
  }

  /** Após o DOM refletir novas mensagens / streaming, leva o scroll ao fundo do thread. */
  private scrollThreadToEnd(): void {
    afterNextRender(
      () => {
        requestAnimationFrame(() => {
          const scrollEl = this.scrollArea()?.nativeElement;
          const anchor = this.threadEnd()?.nativeElement;
          if (anchor && scrollEl?.contains(anchor)) {
            anchor.scrollIntoView({ block: "end", inline: "nearest", behavior: "instant" });
          } else if (scrollEl) {
            scrollEl.scrollTop = scrollEl.scrollHeight;
          }
          requestAnimationFrame(() => {
            if (scrollEl) {
              scrollEl.scrollTop = scrollEl.scrollHeight;
            }
          });
        });
      },
      { injector: this.injector },
    );
  }

  private codeForRequest(): string {
    const raw = this.editorCodeSnapshot?.() ?? this.editorCode ?? "";
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : TUTOR_CHAT_PLACEHOLDER_CODE;
  }

  private async errorsForRequest(): Promise<string[]> {
    if (this.compilerErrorsResolver) {
      try {
        const withTimeout = new Promise<string[]>(resolve => {
          setTimeout(() => {
            resolve(this.compilerErrorsSnapshot?.() ?? []);
          }, 1200);
        });
        return await Promise.race([this.compilerErrorsResolver(), withTimeout]);
      } catch {
        return this.compilerErrorsSnapshot?.() ?? [];
      }
    }
    return this.compilerErrorsSnapshot?.() ?? [];
  }

  onDraftEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey || ke.isComposing) {
      return;
    }

    ke.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || !this.baseUrlConfigured || this.streamingAssistant) {
      return;
    }

    const client = createTutorAgentClient({
      baseUrl: environment.agentApiBaseUrl,
      runInZone: (fn: () => void) => {
        this.ngZone.run(fn);
      },
    });

    // Atualiza o estado na zona do Angular *antes* do await do worker, para haver CD imediata
    // e evitar múltiplos envios enquanto `errorsForRequest` está pendente.
    this.ngZone.run(() => {
      this.history.push({ role: "user", content: text });
      this.draft = "";
      this.error = null;
      this.streamingAssistant = true;
      this.streamingText = "";
      this.scrollThreadToEnd();
    });

    // Worker / Promise pode resolver fora da zona; manter o await dentro do run evita bloquear o resto do fluxo.
    const errors = await this.ngZone.run(async () => this.errorsForRequest());

    // O arranque do `fetch` (primeira linha de `helpStream`) tem de correr dentro da zona, senão
    // a primeira requisição pode não sair até um gatilho externo (ex.: abrir DevTools).
    this.ngZone.run(() => {
      void client
        .helpStream(
          {
            code: this.codeForRequest(),
            errors,
            history: this.history,
          },
          {
            onDiagnosis: diagnosis => {
              this.lastDiagnosis = diagnosis;
              this.cdr.markForCheck();
            },
            onToken: delta => {
              this.streamingText += delta;
              this.scrollThreadToEnd();
              this.cdr.markForCheck();
            },
            onAction: action => {
              this.editorActionsService.dispatch(action);
              this.cdr.markForCheck();
            },
            onDone: () => {
              const reply = this.streamingText;
              this.streamingAssistant = false;
              this.streamingText = "";
              if (reply.length > 0) {
                this.history.push({ role: "assistant", content: reply });
              }
              this.scrollThreadToEnd();
              this.cdr.markForCheck();
            },
          },
        )
        .catch((error: unknown) => {
          this.ngZone.run(() => {
            this.streamingAssistant = false;
            this.streamingText = "";
            this.history.pop();
            this.error = error instanceof TutorAgentError ? error.message : "Falha ao contactar o tutor.";
            this.scrollThreadToEnd();
            this.cdr.markForCheck();
          });
        });
    });
  }

  clearConversation(): void {
    this.history = [];
    this.lastDiagnosis = null;
    this.error = null;
    this.streamingAssistant = false;
    this.streamingText = "";
  }
}
