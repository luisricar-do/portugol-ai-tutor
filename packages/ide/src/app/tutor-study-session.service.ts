import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";
import { Subject } from "rxjs";

/**
 * Estado da sessão de pesquisa (dissertação): participante, condição e tarefa
 * corrente com o respetivo *timebox*.
 *
 * Serviço deliberadamente sem dependência de telemetria — quem observa
 * `lifecycle$` é o `TutorTelemetryService`, mantendo a direção única
 * (telemetria → sessão) e evitando dependência circular.
 */

const STATE_KEY = "pws:tutor:study:state";
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

export interface StudyTask {
  /** 1–6: os seis cenários de depuração do apêndice de enunciados. */
  readonly index: number;
  readonly label: string;
  readonly timeboxMs: number;
}

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

export interface TaskLifecycleEvent {
  kind: "started" | "ended";
  task: StudyTask;
  /** Epoch ms do início da tarefa (preservado entre recarregamentos da aba). */
  startedAt: number;
  elapsedMs: number;
  outcome?: TaskOutcome;
  /** Turnos de chat do estudante nesta tarefa (só relevante no encerramento). */
  studentTurns?: number;
}

interface PersistedState {
  taskIndex: number;
  startedAt: number;
  studentTurns: number;
  helpRequested: boolean;
}

/** Contexto anexado a cada evento de telemetria enquanto uma tarefa está em curso. */
export interface TaskContext {
  task?: number;
  taskElapsedMs?: number;
}

@Injectable({ providedIn: "root" })
export class TutorStudySessionService {
  private readonly destroyRef = inject(DestroyRef);

  // `signal()` exige valor inicial; o `undefined` explícito é obrigatório aqui.
  /* eslint-disable unicorn/no-useless-undefined */
  private readonly participantIdSignal = signal<string | undefined>(undefined);
  private readonly conditionSignal = signal<StudyCondition | undefined>(undefined);
  private readonly taskIndexSignal = signal<number | undefined>(undefined);
  private readonly startedAtSignal = signal<number | undefined>(undefined);
  /* eslint-enable unicorn/no-useless-undefined */
  private readonly studentTurnsSignal = signal(0);
  private readonly helpRequestedSignal = signal(false);
  private readonly nowSignal = signal(Date.now());

  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private visibilityListener: (() => void) | undefined;
  private timeoutEmitted = false;

  private readonly lifecycleSubject = new Subject<TaskLifecycleEvent>();

  /** `task_start` / `task_end` para quem faz o registo (telemetria). */
  readonly lifecycle$ = this.lifecycleSubject.asObservable();

  readonly participantId = this.participantIdSignal.asReadonly();
  readonly condition = this.conditionSignal.asReadonly();
  readonly studentTurnsInTask = this.studentTurnsSignal.asReadonly();
  readonly helpRequestedInTask = this.helpRequestedSignal.asReadonly();

  /** Uma sessão de pesquisa só existe quando há participante atribuído. */
  readonly isStudySession = computed(() => this.participantIdSignal() !== undefined);

  readonly activeTask = computed<StudyTask | undefined>(() => {
    const index = this.taskIndexSignal();
    return index === undefined ? undefined : STUDY_TASKS.find(task => task.index === index);
  });

  readonly isRunning = computed(() => this.activeTask() !== undefined && this.startedAtSignal() !== undefined);

  /**
   * Para a UI: depende de `nowSignal`, logo re-renderiza a cada tique.
   * Não usar para medir — o navegador estrangula `setInterval` em aba oculta.
   */
  readonly elapsedMs = computed(() => {
    const startedAt = this.startedAtSignal();
    return startedAt === undefined ? 0 : Math.max(0, this.nowSignal() - startedAt);
  });

  readonly remainingMs = computed(() => {
    const task = this.activeTask();
    if (task === undefined) {
      return 0;
    }
    // `elapsedMs` pode estar atrasado (tique estrangulado); o relógio real manda.
    const elapsed = Math.max(this.elapsedMs(), this.elapsedMsNow());
    return Math.max(0, task.timeboxMs - elapsed);
  });

  readonly isTimedOut = computed(() => this.isRunning() && this.remainingMs() === 0);

  constructor() {
    this.restore();
    this.destroyRef.onDestroy(() => {
      this.stopTick();
    });
  }

  /** Atribuição vinda da query string (`?pid=P07&cond=exp`) ou da barra de sessão. */
  setParticipant(participantId: string | undefined, condition: StudyCondition | undefined): void {
    this.participantIdSignal.set(participantId?.trim() || undefined);
    this.conditionSignal.set(condition);
  }

  startTask(index: number): void {
    const task = STUDY_TASKS.find(candidate => candidate.index === index);
    if (task === undefined || this.isRunning()) {
      return;
    }

    const startedAt = Date.now();
    this.taskIndexSignal.set(task.index);
    this.startedAtSignal.set(startedAt);
    this.studentTurnsSignal.set(0);
    this.helpRequestedSignal.set(false);
    this.timeoutEmitted = false;
    this.nowSignal.set(startedAt);
    this.persist();
    this.startTick();

    this.lifecycleSubject.next({ kind: "started", task, startedAt, elapsedMs: 0 });
  }

  /** Encerra a tarefa corrente. `timeout` é emitido automaticamente pelo relógio. */
  endTask(outcome: TaskOutcome): void {
    const task = this.activeTask();
    const startedAt = this.startedAtSignal();
    if (task === undefined || startedAt === undefined) {
      return;
    }

    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const studentTurns = this.studentTurnsSignal();

    this.stopTick();
    this.taskIndexSignal.set(undefined);
    this.startedAtSignal.set(undefined);
    this.clearPersisted();

    this.lifecycleSubject.next({ kind: "ended", task, startedAt, elapsedMs, outcome, studentTurns });
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

  /** Contexto para anexar aos eventos de telemetria. */
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

  /** Atualiza o relógio da UI e encerra a tarefa se o timebox já expirou. */
  private refreshClock(): void {
    this.nowSignal.set(Date.now());
    const task = this.activeTask();
    if (task === undefined || this.timeoutEmitted) {
      return;
    }
    if (this.elapsedMsNow() >= task.timeboxMs) {
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
    const task = STUDY_TASKS.find(candidate => candidate.index === raw.taskIndex);
    if (task === undefined) {
      this.clearPersisted();
      return;
    }
    this.taskIndexSignal.set(task.index);
    this.startedAtSignal.set(raw.startedAt);
    this.studentTurnsSignal.set(raw.studentTurns);
    this.helpRequestedSignal.set(raw.helpRequested);
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
        } satisfies PersistedState),
      );
    } catch {
      /* quota esgotada ou modo privado */
    }
  }

  private clearPersisted(): void {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      /* ignora */
    }
  }
}
