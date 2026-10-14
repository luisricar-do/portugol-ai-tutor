import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { maskMatricula, pseudonymFromMatricula } from "@luisricar-do/agent";

import { environment } from "../../environments/environment";
import { TutorSettingsService } from "../tutor-settings.service";
import { TutorTelemetryService } from "../tutor-telemetry.service";
import { TutorStudySessionService } from "../tutor-study-session.service";
import type { TaskOutcome } from "../tutor-study-session.service";
import { WorkspaceService } from "../workspace.service";

/**
 *  *  * Abaixo deste tempo restante o cronómetro passa a estado de aviso.
 */
const WARNING_THRESHOLD_MS = 2 * 60_000;

/**
 * Quantos cenários cada estudante faz (dois quando restarem menos de trinta minutos).
 */
const TASKS_PER_PARTICIPANT = 3;

const OUTCOME_LABELS: Record<TaskOutcome, string> = {
  solved: "concluída",
  timeout: "tempo esgotado",
  aborted: "interrompida",
};

/**
 * Barra de condução da sessão de pesquisa: identifica o participante, inicia e encerra
 * tarefas e aplica o *timebox* do protocolo.
 *
 * Na build de coleta (`studyGate`) a IDE abre com o formulário de matrícula; fora dela, a
 * barra só aparece com `?pid=` ou `?study=1`, para que a IDE pública fique inalterada.
 */
@Component({
  selector: "app-study-session-bar",
  imports: [FormsModule],
  templateUrl: "./study-session-bar.component.html",
  styleUrl: "./study-session-bar.component.scss",
  // O template só lê signals e constantes.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudySessionBarComponent {
  private readonly studySession = inject(TutorStudySessionService);
  private readonly telemetry = inject(TutorTelemetryService);
  private readonly tutorSettings = inject(TutorSettingsService);
  private readonly workspace = inject(WorkspaceService);
  private readonly lifetime = inject(DestroyRef);

  readonly tasksPerParticipant = TASKS_PER_PARTICIPANT;

  readonly participantId = this.studySession.participantId;
  readonly participantLabel = this.studySession.participantLabel;
  readonly condition = this.studySession.condition;
  readonly activeTask = this.studySession.activeTask;
  readonly isRunning = this.studySession.isRunning;
  readonly isTestMode = this.studySession.isTestMode;
  readonly remainingMs = this.studySession.remainingMs;
  readonly studentTurns = this.studySession.studentTurnsInTask;
  readonly taskOrder = this.studySession.taskOrder;

  /**
   * Tarefa escolhida no seletor (ainda não iniciada). Acompanha a ordem sorteada: ao fim de
   * cada tarefa passa à seguinte, o que poupa ao estudante escolher e evita erro de condução.
   */
  readonly selectedTaskIndex = linkedSignal(() => this.studySession.nextTask()?.index ?? this.taskOrder()[0].index);

  readonly lastOutcome = signal<{ label: string; outcome: TaskOutcome } | undefined>(undefined);

  readonly draftMatricula = signal("");
  readonly assignError = signal<string | undefined>(undefined);
  readonly assigning = signal(false);

  readonly visible = computed(
    () => environment.studyGate || this.studySession.isStudySession() || this.isTestMode() || this.studyModeRequested,
  );

  readonly needsAssignment = computed(() => this.participantId() === undefined && !this.isTestMode());

  readonly completedCount = computed(() => this.studySession.completedTasks().length);

  readonly remainingLabel = computed(() => {
    const total = Math.ceil(this.remainingMs() / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  });

  readonly isTimeoutOutcome = computed(() => this.lastOutcome()?.outcome === "timeout");

  readonly isWarning = computed(() => this.isRunning() && this.remainingMs() <= WARNING_THRESHOLD_MS);

  readonly participantChip = computed(() => {
    const who = this.participantLabel() ? `Matrícula ${this.participantLabel()}` : this.participantId();
    const stage = this.condition()?.trim();
    return stage ? `${who} · ${stage}` : who;
  });

  private readonly gateDialog = viewChild<ElementRef<HTMLDialogElement>>("gate");

  private readonly studyModeRequested: boolean;

  constructor() {
    this.studyModeRequested = this.readStudyFlag();

    // `showModal` torna o resto da página inerte: ninguém começa a editar antes de escolher.
    effect(() => {
      const dialog = this.gateDialog()?.nativeElement;
      if (dialog && this.visible() && this.needsAssignment() && !dialog.open) {
        dialog.showModal();
      }
    });

    this.studySession.lifecycle$.pipe(takeUntilDestroyed(this.lifetime)).subscribe(event => {
      if (event.kind !== "ended" || event.outcome === undefined) {
        return;
      }
      this.lastOutcome.set({
        label: `${event.task.label}: ${OUTCOME_LABELS[event.outcome]}`,
        outcome: event.outcome,
      });
    });
  }

  async assignParticipant(): Promise<void> {
    if (this.assigning()) {
      return;
    }
    this.assigning.set(true);
    try {
      const pseudonym = await pseudonymFromMatricula(this.draftMatricula());
      if (pseudonym === undefined) {
        this.assignError.set("Confira a matrícula: só números e letras, de 4 a 20 caracteres.");
        return;
      }
      const condition = this.condition();
      this.studySession.setParticipantLabel(maskMatricula(this.draftMatricula()));
      this.studySession.setParticipant(pseudonym, condition);
      this.telemetry.setParticipant(pseudonym, condition);
      this.telemetry.logAssignment(this.taskOrder().map(task => task.index));
      this.draftMatricula.set("");
      this.assignError.set(undefined);
      this.closeGate();
    } finally {
      this.assigning.set(false);
    }
  }

  startTestMode(): void {
    this.telemetry.enterTestMode();
    this.studySession.enterTestMode();
    this.closeGate();
  }

  /**
   * Fim do participante, ou saída do modo teste: apaga o código das abas e as preferências do
   * tutor, e a página recarrega no formulário. Quem prepara a máquina testa e sai do teste, e o
   * estudante encontra a IDE limpa.
   */
  async endSession(): Promise<void> {
    if (
      !this.isTestMode() &&
      !globalThis.confirm(
        "Encerrar a sessão? Os registros são enviados, o código das abas é apagado e a IDE volta ao formulário de matrícula.",
      )
    ) {
      return;
    }
    await this.telemetry.endSession();
    this.workspace.forgetAll();
    this.tutorSettings.forgetParticipant();
    globalThis.location.reload();
  }

  onMatriculaChange(value: string): void {
    this.draftMatricula.set(value);
    this.assignError.set(undefined);
  }

  /**
   * Esc fecharia o diálogo e deixaria a IDE aberta sem escolha feita.
   */
  onGateCancel(event: Event): void {
    event.preventDefault();
  }

  startTask(): void {
    this.lastOutcome.set(undefined);
    this.studySession.startTask(this.selectedTaskIndex());
  }

  finishTask(): void {
    this.studySession.endTask("solved");
  }

  abortTask(): void {
    this.studySession.endTask("aborted");
  }

  onSelectedTaskChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedTaskIndex.set(Number.parseInt(value, 10));
  }

  isCompleted(index: number): boolean {
    return this.studySession.completedTasks().includes(index);
  }

  private closeGate(): void {
    this.gateDialog()?.nativeElement.close();
  }

  private readStudyFlag(): boolean {
    try {
      return new URLSearchParams(window.location.search).get("study") === "1";
    } catch {
      return false;
    }
  }
}
