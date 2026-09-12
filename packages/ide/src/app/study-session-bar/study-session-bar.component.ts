import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";

import { TutorTelemetryService } from "../tutor-telemetry.service";
import { STUDY_TASKS, TutorStudySessionService } from "../tutor-study-session.service";
import type { TaskOutcome } from "../tutor-study-session.service";

/** Abaixo deste tempo restante o cronómetro passa a estado de aviso. */
const WARNING_THRESHOLD_MS = 2 * 60_000;

const OUTCOME_LABELS: Record<TaskOutcome, string> = {
  solved: "concluída",
  timeout: "tempo esgotado",
  aborted: "interrompida",
};

/**
 * Barra de condução da sessão de pesquisa: atribui participante e condição,
 * inicia e encerra tarefas e aplica o *timebox* do protocolo.
 *
 * Invisível fora de uma sessão de pesquisa (sem `?pid=` nem `?study=1` na URL),
 * para que a IDE pública fique inalterada.
 */
@Component({
  selector: "app-study-session-bar",
  imports: [FormsModule, MatButtonModule],
  standalone: true,
  templateUrl: "./study-session-bar.component.html",
  styleUrl: "./study-session-bar.component.scss",
})
export class StudySessionBarComponent {
  private readonly studySession = inject(TutorStudySessionService);
  private readonly telemetry = inject(TutorTelemetryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tasks = STUDY_TASKS;

  readonly participantId = this.studySession.participantId;
  readonly condition = this.studySession.condition;
  readonly activeTask = this.studySession.activeTask;
  readonly isRunning = this.studySession.isRunning;
  readonly remainingMs = this.studySession.remainingMs;
  readonly studentTurns = this.studySession.studentTurnsInTask;

  /** Tarefa escolhida no seletor (ainda não iniciada). */
  readonly selectedTaskIndex = signal(this.tasks[0].index);

  // eslint-disable-next-line unicorn/no-useless-undefined -- `signal()` exige valor inicial
  readonly lastOutcome = signal<{ label: string; outcome: TaskOutcome } | undefined>(undefined);

  /** Formulário de atribuição, usado quando a IDE abre com `?study=1` sem `?pid=`. */
  readonly draftParticipantId = signal("");
  readonly draftCondition = signal("");

  readonly visible = computed(() => this.studySession.isStudySession() || this.studyModeRequested);

  readonly needsAssignment = computed(() => this.studySession.participantId() === undefined);

  readonly remainingLabel = computed(() => {
    const total = Math.ceil(this.remainingMs() / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  });

  readonly isTimeoutOutcome = computed(() => this.lastOutcome()?.outcome === "timeout");

  readonly isWarning = computed(() => this.isRunning() && this.remainingMs() <= WARNING_THRESHOLD_MS);

  readonly conditionLabel = computed(() => this.condition()?.trim() || "sem etapa");

  private readonly studyModeRequested: boolean;

  constructor() {
    this.studyModeRequested = this.readStudyFlag();

    this.studySession.lifecycle$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event.kind !== "ended" || event.outcome === undefined) {
        return;
      }
      this.lastOutcome.set({
        label: `${event.task.label}: ${OUTCOME_LABELS[event.outcome]}`,
        outcome: event.outcome,
      });
      // Avança o seletor para a tarefa seguinte, reduzindo erro de condução.
      const next = this.tasks.find(task => task.index > event.task.index);
      if (next) {
        this.selectedTaskIndex.set(next.index);
      }
    });
  }

  assignParticipant(): void {
    const id = this.draftParticipantId().trim();
    if (!id) {
      return;
    }
    this.telemetry.setParticipant(id, this.draftCondition());
    this.studySession.setParticipant(id, this.draftCondition());
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

  private readStudyFlag(): boolean {
    try {
      return new URLSearchParams(window.location.search).get("study") === "1";
    } catch {
      return false;
    }
  }
}
