import { DestroyRef, Service, computed, inject, signal } from "@angular/core";
import { studyTaskOrder } from "@luisricar-do/agent";
import { Subject } from "rxjs";

import { environment } from "../environments/environment";

/**
 * Estado da sessão de pesquisa (dissertação): participante, condição e tarefa
 * corrente com o respetivo *timebox*.
 *
 * Serviço deliberadamente sem dependência de telemetria — quem observa
 * `lifecycle$` é o `TutorTelemetryService`, mantendo a direção única
 * (telemetria → sessão) e evitando dependência circular.
 */

const STATE_KEY = "pws:tutor:study:state";
/**
 * `"1"` quando quem abriu a IDE escolheu "Só estou testando": nada é coletado nesta aba.
 */
export const STUDY_TEST_MODE_KEY = "pws:tutor:study:testMode";
/**
 * Matrícula mascarada (`…1234`), só para o estudante conferir na barra. Não sai do navegador.
 */
const LABEL_KEY = "pws:tutor:study:label";
/**
 * Cenários já encerrados nesta sessão, para a barra propor o seguinte da ordem sorteada.
 */
const COMPLETED_KEY = "pws:tutor:study:completed";
const TICK_INTERVAL_MS = 1000;

/**
 * Rótulo livre da etapa de coleta (ex.: `piloto`, `turma-2026-1`).
 *
 * O desenho de avaliação não tem grupos: em uso real corre apenas o artefato, e as condições
 * A (artefato) e C (referência descritiva) existem só em bancada, fora da IDE. O rótulo serve
 * para separar coletas no dataset, não para marcar braço experimental.
 */
export type StudyCondition = string;
export type TaskOutcome = "solved" | "timeout" | "aborted";
/**
 * Quem encerrou a tarefa quando não foi o estudante nem o relógio: o condutor, pelo painel.
 */
export type TaskEndedBy = "conductor";

export interface StudyTask {
  /**
   * 1–6: os seis cenários de depuração do apêndice de enunciados; 0: o treino.
   */
  readonly index: number;
  readonly label: string;
  readonly timeboxMs: number;
  /**
   * Exercício de ambientação: igual para todos, fora do banco e fora das trajetórias.
   */
  readonly practice?: boolean;
}

/**
 * Treino que abre a sessão (Bloco 2 do roteiro, ambientação): todos fazem o mesmo exercício,
 * com o mesmo fluxo dos cenários (Iniciar, cronómetro, Ada, Concluí), para que dúvidas e
 * problemas de máquina apareçam antes da coleta. Os turnos com o tutor vão para
 * `interactions/treino-…/` (ver `TutorTelemetryService.sessionId`).
 */
export const PRACTICE_TASK: StudyTask = {
  index: 0,
  label: "Treino — Troco da compra",
  timeboxMs: 10 * 60_000,
  practice: true,
};

/**
 * Cenários e timeboxes do apêndice de enunciados: 10 min em T1–T2, 15 min em T3–T6.
 *
 * Não há pré-teste nem tarefa de transferência: os estudantes não são medidos, são a fonte de
 * entradas reais para o artefato, e cada um depura dois ou três destes cenários.
 */
export const STUDY_TASKS: readonly StudyTask[] = [
  { index: 1, label: "T1 — Média aritmética", timeboxMs: 10 * 60_000 },
  { index: 2, label: "T2 — Aprovação por nota", timeboxMs: 10 * 60_000 },
  { index: 3, label: "T3 — Tabuada", timeboxMs: 15 * 60_000 },
  { index: 4, label: "T4 — Par ou ímpar", timeboxMs: 15 * 60_000 },
  { index: 5, label: "T5 — Maior do vetor", timeboxMs: 15 * 60_000 },
  { index: 6, label: "T6 — Contagem condicional em vetor", timeboxMs: 15 * 60_000 },
];

function findTask(index: number): StudyTask | undefined {
  return index === PRACTICE_TASK.index ? PRACTICE_TASK : STUDY_TASKS.find(task => task.index === index);
}

export interface TaskLifecycleEvent {
  kind: "started" | "ended";
  task: StudyTask;
  /**
   * Epoch ms do início da tarefa (preservado entre recarregamentos da aba).
   */
  startedAt: number;
  elapsedMs: number;
  outcome?: TaskOutcome;
  /**
   * Turnos de chat do estudante nesta tarefa (só relevante no encerramento).
   */
  studentTurns?: number;
  endedBy?: TaskEndedBy;
  /**
   * Tempo extra dado pelo condutor nesta tarefa (só no encerramento).
   */
  extraMs?: number;
}

interface PersistedState {
  taskIndex: number;
  startedAt: number;
  studentTurns: number;
  helpRequested: boolean;
  /**
   * Tempo dado pelo condutor além do *timebox* do protocolo.
   */
  extraMs: number;
}

/**
 * Contexto anexado a cada evento de telemetria enquanto uma tarefa está em curso.
 */
export interface TaskContext {
  task?: number;
  taskElapsedMs?: number;
}

@Service()
export class TutorStudySessionService {
  private readonly lifetime = inject(DestroyRef);

  // `signal()` exige valor inicial; o `undefined` explícito é obrigatório aqui.

  private readonly participantIdSignal = signal<string | undefined>(undefined);
  private readonly conditionSignal = signal<StudyCondition | undefined>(undefined);
  private readonly taskIndexSignal = signal<number | undefined>(undefined);
  private readonly startedAtSignal = signal<number | undefined>(undefined);

  private readonly testModeSignal = signal(this.readFlag(STUDY_TEST_MODE_KEY));
  private readonly participantLabelSignal = signal<string | undefined>(this.readText(LABEL_KEY));
  private readonly completedSignal = signal<readonly number[]>(this.readCompleted());

  private readonly studentTurnsSignal = signal(0);
  private readonly helpRequestedSignal = signal(false);
  private readonly extraMsSignal = signal(0);
  private readonly nowSignal = signal(Date.now());

  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private visibilityListener: (() => void) | undefined;
  private timeoutEmitted = false;

  private readonly lifecycleSubject = new Subject<TaskLifecycleEvent>();

  /**
   * `task_start` / `task_end` para quem faz o registo (telemetria).
   */
  readonly lifecycle$ = this.lifecycleSubject.asObservable();

  readonly participantId = this.participantIdSignal.asReadonly();
  readonly condition = this.conditionSignal.asReadonly();
  readonly studentTurnsInTask = this.studentTurnsSignal.asReadonly();
  readonly helpRequestedInTask = this.helpRequestedSignal.asReadonly();

  /**
   * Uma sessão de pesquisa só existe quando há participante atribuído.
   */
  readonly isStudySession = computed(() => this.participantIdSignal() !== undefined);

  /**
   * Aba aberta em "Só estou testando": a barra funciona, mas a telemetria não é criada.
   */
  readonly isTestMode = this.testModeSignal.asReadonly();

  /**
   * O que a barra mostra no lugar do pseudônimo (`…1234`); ausente com `?pid=`.
   */
  readonly participantLabel = this.participantLabelSignal.asReadonly();

  readonly completedTasks = this.completedSignal.asReadonly();

  /**
   * O treino primeiro, depois os seis cenários na ordem sorteada a partir do identificador:
   * estável entre recarregamentos e refeita na análise com `studyTaskOrder`. Sem participante
   * (modo teste), a ordem do apêndice.
   */
  readonly taskOrder = computed<readonly StudyTask[]>(() => {
    const participantId = this.participantIdSignal();
    const scenarios =
      participantId === undefined
        ? STUDY_TASKS
        : studyTaskOrder(
            participantId,
            STUDY_TASKS.map(task => task.index),
          ).flatMap(index => STUDY_TASKS.filter(task => task.index === index));
    return [PRACTICE_TASK, ...scenarios];
  });

  /**
   * Cenários encerrados, sem o treino: é o que a barra conta como feito.
   */
  readonly completedScenarioCount = computed(
    () => this.completedSignal().filter(index => index !== PRACTICE_TASK.index).length,
  );

  /**
   * Primeiro cenário da ordem ainda não encerrado.
   */
  readonly nextTask = computed<StudyTask | undefined>(() => {
    const done = new Set(this.completedSignal());
    return this.taskOrder().find(task => !done.has(task.index));
  });

  readonly activeTask = computed<StudyTask | undefined>(() => {
    const index = this.taskIndexSignal();
    return index === undefined ? undefined : findTask(index);
  });

  readonly isRunning = computed(() => this.activeTask() !== undefined && this.startedAtSignal() !== undefined);

  /**
   * Na sessão de pesquisa a IDE esconde o que não serve à tarefa (abrir arquivo, exemplos, nova
   * aba, fechar a aba da tarefa): menos caminhos para o estudante se perder ou perder o código.
   */
  readonly simplifiedUi = computed(() => environment.studyGate || this.isStudySession() || this.testModeSignal());

  /**
   * *Timebox* da tarefa corrente mais o tempo extra dado pelo condutor.
   */
  readonly effectiveTimeboxMs = computed(() => (this.activeTask()?.timeboxMs ?? 0) + this.extraMsSignal());

  /**
   * Para a UI: depende de `nowSignal`, logo re-renderiza a cada tique.
   * Não usar para medir — o navegador estrangula `setInterval` em aba oculta.
   */
  readonly elapsedMs = computed(() => {
    const startedAt = this.startedAtSignal();
    return startedAt === undefined ? 0 : Math.max(0, this.nowSignal() - startedAt);
  });

  readonly remainingMs = computed(() => {
    if (this.activeTask() === undefined) {
      return 0;
    }
    // `elapsedMs` pode estar atrasado (tique estrangulado); o relógio real manda.
    const elapsed = Math.max(this.elapsedMs(), this.elapsedMsNow());
    return Math.max(0, this.effectiveTimeboxMs() - elapsed);
  });

  readonly isTimedOut = computed(() => this.isRunning() && this.remainingMs() === 0);

  constructor() {
    this.restore();
    this.lifetime.onDestroy(() => {
      this.stopTick();
    });
  }

  /**
   * Atribuição vinda da query string (`?pid=P07&cond=exp`) ou da barra de sessão.
   */
  setParticipant(participantId: string | undefined, condition: StudyCondition | undefined): void {
    this.participantIdSignal.set(participantId?.trim() || undefined);
    this.conditionSignal.set(condition);
  }

  setParticipantLabel(label: string | undefined): void {
    this.participantLabelSignal.set(label);
    this.writeText(LABEL_KEY, label);
  }

  enterTestMode(): void {
    this.testModeSignal.set(true);
    this.writeText(STUDY_TEST_MODE_KEY, "1");
  }

  /**
   * Apaga o estado da sessão desta aba (participante seguinte no mesmo computador). Quem chama
   * recarrega a página.
   */
  clearSession(): void {
    this.stopTick();
    for (const key of [STATE_KEY, STUDY_TEST_MODE_KEY, LABEL_KEY, COMPLETED_KEY]) {
      this.writeText(key, undefined);
    }
  }

  startTask(index: number): void {
    const task = findTask(index);
    if (task === undefined || this.isRunning()) {
      return;
    }

    const startedAt = Date.now();
    this.taskIndexSignal.set(task.index);
    this.startedAtSignal.set(startedAt);
    this.studentTurnsSignal.set(0);
    this.helpRequestedSignal.set(false);
    this.extraMsSignal.set(0);
    this.timeoutEmitted = false;
    this.nowSignal.set(startedAt);
    this.persist();
    this.startTick();

    this.lifecycleSubject.next({ kind: "started", task, startedAt, elapsedMs: 0 });
  }

  /**
   * Mais tempo na tarefa corrente (comando do condutor). Não reabre tarefa já encerrada.
   */
  extendTask(extraMs: number): void {
    if (!this.isRunning() || extraMs <= 0) {
      return;
    }
    this.extraMsSignal.update(value => value + extraMs);
    this.persist();
    this.nowSignal.set(Date.now());
  }

  /**
   * Encerra a tarefa corrente. `timeout` é emitido automaticamente pelo relógio.
   */
  endTask(outcome: TaskOutcome, endedBy?: TaskEndedBy): void {
    const task = this.activeTask();
    const startedAt = this.startedAtSignal();
    if (task === undefined || startedAt === undefined) {
      return;
    }

    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const studentTurns = this.studentTurnsSignal();
    const extraMs = this.extraMsSignal();

    this.stopTick();
    this.taskIndexSignal.set(undefined);
    this.startedAtSignal.set(undefined);
    this.clearPersisted();
    this.completedSignal.update(done => (done.includes(task.index) ? done : [...done, task.index]));
    this.writeText(COMPLETED_KEY, JSON.stringify(this.completedSignal()));

    this.lifecycleSubject.next({ kind: "ended", task, startedAt, elapsedMs, outcome, studentTurns, endedBy, extraMs });
  }

  /**
   * Registra um pedido de orientação do estudante.
   * Devolve `true` na primeira vez em cada tarefa — o marco que abre a janela da
   * métrica de atrito.
   */
  noteStudentHelpRequest(): boolean {
    if (!this.isRunning()) {
      return false;
    }
    this.studentTurnsSignal.update(value => value + 1);
    const isFirst = !this.helpRequestedSignal();
    if (isFirst) {
      this.helpRequestedSignal.set(true);
    }
    this.persist();
    return isFirst;
  }

  /**
   * Tempo decorrido medido no instante da chamada.
   *
   * Deliberadamente fora do sistema reativo: o navegador estrangula
   * `setInterval` em aba oculta (até 1×/minuto), pelo que o valor derivado do
   * tique atrasa. Toda a medição registada usa este caminho.
   */
  elapsedMsNow(): number {
    const startedAt = this.startedAtSignal();
    return startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
  }

  /**
   * Contexto para anexar aos eventos de telemetria.
   */
  taskContext(): TaskContext {
    const task = this.activeTask();
    if (task === undefined) {
      return {};
    }
    return { task: task.index, taskElapsedMs: this.elapsedMsNow() };
  }

  private startTick(): void {
    this.stopTick();
    if (typeof window === "undefined") {
      return;
    }
    this.tickTimer = setInterval(() => {
      this.refreshClock();
    }, TICK_INTERVAL_MS);

    // Aba oculta estrangula o `setInterval`: ao voltar, o timebox pode já ter
    // expirado sem que nenhum tique tenha corrido. Reavaliar aqui fecha a lacuna.
    this.visibilityListener = () => {
      this.refreshClock();
    };
    document.addEventListener("visibilitychange", this.visibilityListener);
    window.addEventListener("focus", this.visibilityListener);
  }

  /**
   * Atualiza o relógio da UI e encerra a tarefa se o timebox já expirou.
   */
  private refreshClock(): void {
    this.nowSignal.set(Date.now());
    const task = this.activeTask();
    if (task === undefined || this.timeoutEmitted) {
      return;
    }
    if (this.elapsedMsNow() >= this.effectiveTimeboxMs()) {
      this.timeoutEmitted = true;
      this.endTask("timeout");
    }
  }

  private stopTick(): void {
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    if (this.visibilityListener !== undefined) {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      window.removeEventListener("focus", this.visibilityListener);
      this.visibilityListener = undefined;
    }
  }

  /**
   * Recarregar a aba no meio de uma tarefa não pode reiniciar o cronómetro: o
   * `startedAt` original é restaurado do `sessionStorage`.
   */
  private restore(): void {
    const raw = this.readRaw();
    if (!raw) {
      return;
    }
    const task = findTask(raw.taskIndex);
    if (task === undefined) {
      this.clearPersisted();
      return;
    }
    this.taskIndexSignal.set(task.index);
    this.startedAtSignal.set(raw.startedAt);
    this.studentTurnsSignal.set(raw.studentTurns);
    this.helpRequestedSignal.set(raw.helpRequested);
    this.extraMsSignal.set(raw.extraMs);
    this.nowSignal.set(Date.now());
    this.startTick();
  }

  private readRaw(): PersistedState | undefined {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (typeof parsed.taskIndex !== "number" || typeof parsed.startedAt !== "number") {
        return undefined;
      }
      return {
        taskIndex: parsed.taskIndex,
        startedAt: parsed.startedAt,
        studentTurns: typeof parsed.studentTurns === "number" ? parsed.studentTurns : 0,
        helpRequested: parsed.helpRequested === true,
        extraMs: typeof parsed.extraMs === "number" ? parsed.extraMs : 0,
      };
    } catch {
      return undefined;
    }
  }

  private persist(): void {
    const taskIndex = this.taskIndexSignal();
    const startedAt = this.startedAtSignal();
    if (taskIndex === undefined || startedAt === undefined) {
      return;
    }
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          taskIndex,
          startedAt,
          studentTurns: this.studentTurnsSignal(),
          helpRequested: this.helpRequestedSignal(),
          extraMs: this.extraMsSignal(),
        } satisfies PersistedState),
      );
    } catch {
      // quota esgotada ou modo privado
    }
  }

  private readFlag(key: string): boolean {
    return this.readText(key) === "1";
  }

  private readCompleted(): readonly number[] {
    try {
      const parsed = JSON.parse(this.readText(COMPLETED_KEY) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
    } catch {
      return [];
    }
  }

  private readText(key: string): string | undefined {
    try {
      return sessionStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private writeText(key: string, value: string | undefined): void {
    try {
      if (value === undefined) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
      }
    } catch {
      // quota esgotada ou modo privado
    }
  }

  private clearPersisted(): void {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      // ignora
    }
  }
}
