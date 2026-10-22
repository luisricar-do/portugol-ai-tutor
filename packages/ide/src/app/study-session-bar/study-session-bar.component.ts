import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { maskMatricula, pseudonymFromMatricula } from "@luisricar-do/agent";

import { environment } from "../../environments/environment";
import { StudyCheckService } from "../study-check.service";
import { taskMaterial } from "../study-material";
import { StudyRemoteControlService } from "../study-remote-control.service";
import { TutorTelemetryService } from "../tutor-telemetry.service";
import { TutorStudySessionService } from "../tutor-study-session.service";
import type { StudyTask, TaskEndedBy, TaskOutcome } from "../tutor-study-session.service";
import { WorkspaceService } from "../workspace.service";

/**
 * Abaixo deste tempo restante o cronómetro passa a estado de aviso.
 */
const WARNING_THRESHOLD_MS = 2 * 60_000;

/**
 * Quantos cenários cada estudante faz. Com menos de trinta minutos, o condutor encerra depois do
 * segundo pelo painel.
 */
const TASKS_PER_PARTICIPANT = 3;

/**
 * Aba aberta por **Iniciar**, para fechá-la no fim da tarefa mesmo depois de recarregar.
 */
const TASK_TAB_KEY = "pws:tutor:study:taskTab";

/**
 * O que o diálogo da tarefa mostra: o próximo exercício (entre tarefas), o enunciado de novo
 * (durante a tarefa, a pedido) ou o fim da sessão.
 */
type TaskDialogMode = "next" | "statement" | "done";

/**
 * Barra de condução da sessão de pesquisa: identifica o participante, apresenta cada exercício
 * num diálogo grande, cronometra e confere a solução com os casos de teste.
 *
 * O fluxo não tem escolha a fazer: o próximo exercício da ordem sorteada aparece sozinho, o
 * cronómetro só corre depois de **Iniciar**, e o **Concluí** só encerra quando o programa passa
 * nos casos. O que antes era **Interromper** ficou com o condutor, no painel.
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
  private readonly workspace = inject(WorkspaceService);
  private readonly checker = inject(StudyCheckService);
  private readonly remoteControl = inject(StudyRemoteControlService);
  private readonly lifetime = inject(DestroyRef);

  readonly tasksPerParticipant = TASKS_PER_PARTICIPANT;

  readonly participantId = this.studySession.participantId;
  readonly participantLabel = this.studySession.participantLabel;
  readonly condition = this.studySession.condition;
  readonly activeTask = this.studySession.activeTask;
  readonly isRunning = this.studySession.isRunning;
  readonly isTestMode = this.studySession.isTestMode;
  readonly remainingMs = this.studySession.remainingMs;
  readonly completedCount = this.studySession.completedScenarioCount;

  readonly lastOutcome = signal<{ task: StudyTask; outcome: TaskOutcome; endedBy?: TaskEndedBy } | undefined>(
    undefined,
  );

  /**
   * Enunciado reaberto durante a tarefa (botão **Ver enunciado**).
   */
  readonly statementOpen = signal(false);

  readonly checking = signal(false);
  /**
   * Por que o **Concluí** não encerrou: só a entrada do caso que falhou, sem a saída esperada.
   */
  readonly checkFeedback = signal<string | undefined>(undefined);

  readonly draftMatricula = signal("");
  readonly assignError = signal<string | undefined>(undefined);
  readonly assigning = signal(false);

  readonly visible = computed(
    () => environment.studyGate || this.studySession.isStudySession() || this.isTestMode() || this.studyModeRequested,
  );

  readonly needsAssignment = computed(() => this.participantId() === undefined && !this.isTestMode());

  /**
   * Fim quando os cenários previstos estão feitos ou a ordem acabou.
   */
  readonly sessionDone = computed(
    () => this.completedCount() >= TASKS_PER_PARTICIPANT || this.studySession.nextTask() === undefined,
  );

  /**
   * Tarefa que o diálogo apresenta: a corrente, durante a tarefa; a próxima, entre tarefas.
   */
  readonly dialogTask = computed(() => this.activeTask() ?? this.studySession.nextTask());

  readonly dialogMaterial = computed(() => {
    const task = this.dialogTask();
    return task === undefined ? undefined : taskMaterial(task.index);
  });

  readonly dialogMode = computed<TaskDialogMode | undefined>(() => {
    if (!this.visible() || this.needsAssignment()) {
      return;
    }
    if (this.isRunning()) {
      return this.statementOpen() ? "statement" : undefined;
    }
    return this.sessionDone() ? "done" : "next";
  });

  readonly activeMaterial = computed(() => {
    const task = this.activeTask();
    return task === undefined ? undefined : taskMaterial(task.index);
  });

  /**
   * "Treino" ou "Exercício 2 de 3": o estudante sabe onde está sem ver a ordem inteira.
   */
  readonly heading = computed(() => {
    const task = this.dialogTask();
    if (task === undefined) {
      return "";
    }
    return task.practice ? "Treino" : `Exercício ${this.completedCount() + 1} de ${TASKS_PER_PARTICIPANT}`;
  });

  readonly dialogMinutes = computed(() => Math.round((this.dialogTask()?.timeboxMs ?? 0) / 60_000));

  /**
   * Faixa no topo do diálogo seguinte: como terminou o exercício anterior.
   */
  readonly outcomeBanner = computed(() => {
    const last = this.lastOutcome();
    if (last === undefined) {
      return;
    }
    const what = last.task.practice ? "Treino" : "Exercício";
    // Aceite pelo painel não passou nos casos: o estudante não pode ler que passou.
    if (last.endedBy === "conductor") {
      return { text: `${what} encerrado pelo pesquisador.`, tone: "info" as const };
    }
    switch (last.outcome) {
      case "solved": {
        return { text: `${what} concluído: o programa passou em todos os casos de teste.`, tone: "ok" as const };
      }
      case "timeout": {
        return { text: `O tempo do ${what.toLowerCase()} acabou. Vamos para o próximo.`, tone: "warn" as const };
      }
      default: {
        return { text: `${what} encerrado pelo pesquisador.`, tone: "info" as const };
      }
    }
  });

  readonly remainingLabel = computed(() => {
    const total = Math.ceil(this.remainingMs() / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  });

  readonly isWarning = computed(() => this.isRunning() && this.remainingMs() <= WARNING_THRESHOLD_MS);

  readonly participantChip = computed(() => {
    const who = this.participantLabel() ? `Matrícula ${this.participantLabel()}` : this.participantId();
    const stage = this.condition()?.trim();
    return stage ? `${who} · ${stage}` : who;
  });

  private readonly gateDialog = viewChild<ElementRef<HTMLDialogElement>>("gate");
  private readonly taskDialog = viewChild<ElementRef<HTMLDialogElement>>("taskDialog");

  private readonly studyModeRequested: boolean;

  constructor() {
    this.studyModeRequested = this.readStudyFlag();
    this.remoteControl.start();

    // `showModal` torna o resto da página inerte: ninguém começa a editar antes de escolher.
    effect(() => {
      const dialog = this.gateDialog()?.nativeElement;
      if (dialog && this.visible() && this.needsAssignment() && !dialog.open) {
        dialog.showModal();
      }
    });

    // Entre tarefas o diálogo fica aberto e modal: nada se edita fora do cronómetro.
    effect(() => {
      const dialog = this.taskDialog()?.nativeElement;
      if (dialog === undefined) {
        return;
      }
      const mode = this.dialogMode();
      if (mode !== undefined && !dialog.open) {
        dialog.showModal();
      } else if (mode === undefined && dialog.open) {
        dialog.close();
      }
    });

    this.studySession.lifecycle$.pipe(takeUntilDestroyed(this.lifetime)).subscribe(event => {
      if (event.kind !== "ended" || event.outcome === undefined) {
        return;
      }
      this.closeTaskTab();
      this.checkFeedback.set(undefined);
      this.statementOpen.set(false);
      this.lastOutcome.set({ task: event.task, outcome: event.outcome, endedBy: event.endedBy });
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
      this.telemetry.logAssignment(this.studySession.taskOrder().map(task => task.index));
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
      !this.sessionDone() &&
      !globalThis.confirm(
        "Encerrar a sessão? Os registros são enviados, o código das abas é apagado e a IDE volta ao formulário de matrícula.",
      )
    ) {
      return;
    }
    await this.remoteControl.endSessionAndReload();
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

  /**
   * Esc só fecha o enunciado reaberto durante a tarefa; entre tarefas o diálogo é o caminho.
   */
  onTaskDialogCancel(event: Event): void {
    event.preventDefault();
    if (this.dialogMode() === "statement") {
      this.statementOpen.set(false);
    }
  }

  showStatement(): void {
    this.statementOpen.set(true);
  }

  hideStatement(): void {
    this.statementOpen.set(false);
  }

  /**
   * Inicia o cronómetro e abre o programa defeituoso numa aba própria, idêntico ao estado
   * inicial da bancada. Cada tarefa tem a sua aba, e com ela a sua conversa com o tutor.
   */
  startTask(): void {
    const next = this.studySession.nextTask();
    if (next === undefined || this.isRunning()) {
      return;
    }
    this.lastOutcome.set(undefined);
    this.checkFeedback.set(undefined);
    this.studySession.startTask(next.index);
    const task = this.activeTask();
    const material = task === undefined ? undefined : taskMaterial(task.index);
    if (task === undefined || material === undefined) {
      return;
    }
    const tabId = this.workspace.addTab(task.label, material.code);
    this.workspace.requestFocus(tabId);
    this.writeTaskTab(tabId);
  }

  /**
   * **Concluí**: roda os casos de teste no navegador. Só passa à seguinte quando todos passam;
   * senão diz a entrada do primeiro caso que falhou e o estudante continua.
   */
  async finishTask(): Promise<void> {
    const task = this.activeTask();
    const material = this.activeMaterial();
    if (task === undefined || material === undefined || this.checking()) {
      return;
    }
    this.checking.set(true);
    this.checkFeedback.set(undefined);
    try {
      const result = await this.checker.check(this.taskCode(), material.tests);
      // O relógio (ou o painel) pode ter encerrado a tarefa durante a conferência.
      if (this.activeTask()?.index !== task.index) {
        return;
      }
      this.telemetry.logTaskCheck(result);
      if (result.passed) {
        this.studySession.endTask("solved");
        return;
      }
      if (result.compileError) {
        this.checkFeedback.set(
          "Ainda não: o programa tem erro de compilação. Veja a lista de Problemas abaixo do código.",
        );
      } else if (result.failedCase) {
        this.checkFeedback.set(
          `Ainda não: com a entrada ${this.formatInput(result.failedCase.input)} o programa não dá o resultado esperado. Continue corrigindo.`,
        );
      }
    } catch (error) {
      console.error(error, { studyCheck: true });
      this.checkFeedback.set("Não foi possível conferir agora. Tente de novo; se continuar, chame o pesquisador.");
    } finally {
      this.checking.set(false);
    }
  }

  formatInput(input: readonly string[]): string {
    return input.length === 0 ? "(nenhuma)" : input.join(", ");
  }

  /**
   * Código da aba da tarefa; a aba ativa como reserva, caso o registo da aba se tenha perdido.
   */
  private taskCode(): string {
    const tabId = this.readTaskTab();
    return tabId ? this.workspace.contentsOf(tabId) : (this.workspace.activeTab()?.contents ?? "");
  }

  /**
   * Fim da tarefa: a aba sai, para o estudante não continuar a editar fora do tempo.
   */
  private closeTaskTab(): void {
    const tabId = this.readTaskTab();
    try {
      sessionStorage.removeItem(TASK_TAB_KEY);
    } catch {
      // modo privado
    }
    if (tabId) {
      this.workspace.closeTab(tabId);
    }
  }

  private readTaskTab(): string | undefined {
    try {
      return sessionStorage.getItem(TASK_TAB_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private writeTaskTab(tabId: string): void {
    try {
      sessionStorage.setItem(TASK_TAB_KEY, tabId);
    } catch {
      // quota esgotada ou modo privado
    }
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
