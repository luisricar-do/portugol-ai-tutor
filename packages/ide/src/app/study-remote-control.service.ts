import { DestroyRef, Service, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { parseStudyControl } from "@luisricar-do/agent";

import { environment } from "../environments/environment";
import { TutorSettingsService } from "./tutor-settings.service";
import { TutorStudySessionService } from "./tutor-study-session.service";
import { TutorTelemetryService } from "./tutor-telemetry.service";
import { WorkspaceService } from "./workspace.service";

/**
 * Último comando aplicado nesta aba: o seguinte pedido só traz os mais novos, e recarregar a aba
 * não aplica o mesmo "+5 min" duas vezes.
 */
const LAST_COMMAND_KEY = "pws:tutor:study:lastCommand";
const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8000;
/**
 * Teto de espera da leitura do controle no **Iniciar**: o clique não pode ficar pendurado numa
 * rede lenta; passado isto vale o último valor lido pelo polling.
 */
const START_CONTROL_TIMEOUT_MS = 3000;

/**
 * Comando que o condutor envia pelo painel (`GET /api/painel`, no serviço do tutor).
 */
export interface ConductorCommand {
  id: string;
  kind: "extend" | "accept" | "skip" | "end_session";
  minutes?: number;
}

/**
 * Canal do painel do condutor para esta aba: consulta `GET {api}/coleta/comandos` e aplica o que
 * vier. Só roda com participante identificado, para a IDE pública não fazer pedido nenhum.
 *
 * O que cada comando faz:
 * - `extend`: soma minutos ao *timebox* da tarefa em curso;
 * - `accept`: encerra a tarefa como resolvida (`endedBy: "conductor"`) e passa à seguinte;
 * - `skip`: encerra sem resolver (`aborted`, `endedBy: "conductor"`) e passa à seguinte;
 * - `end_session`: envia os registros, limpa a máquina e volta ao formulário de matrícula.
 *
 * Pelo mesmo relógio, fora de tarefa, lê também o controle global da coleta em
 * `GET {api}/coleta/controle` (não depende da sessão, por isso corre também no modo teste):
 * - `inicioLiberado`: a trava pós-treino; a barra espera o «Liberar início» do condutor;
 * - `preCodigo`: se o próximo cenário abre com o código defeituoso. É relido no **Iniciar**
 *   (`controlForStart`), para valer o que o painel diz no instante em que o cenário começa.
 */
@Service()
export class StudyRemoteControlService {
  private readonly studySession = inject(TutorStudySessionService);
  private readonly telemetry = inject(TutorTelemetryService);
  private readonly tutorSettings = inject(TutorSettingsService);
  private readonly workspace = inject(WorkspaceService);
  private readonly lifetime = inject(DestroyRef);

  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private controlRequest: Promise<void> | undefined;

  /**
   * Build sem `AGENT_API_BASE_URL` não tem painel que libere: lá a trava não existe.
   */
  private readonly startReleasedSignal = signal<boolean | undefined>(apiBaseUrl() ? undefined : true);
  /**
   * Último `preCodigo` lido; `undefined` enquanto o serviço não respondeu nenhuma vez.
   */
  private readonly starterCodeReadSignal = signal<boolean | undefined>(undefined);
  /**
   * `false` enquanto há uma leitura em curso depois de o valor ter ficado velho (aba nova, fim de
   * tarefa): a barra não mostra o enunciado seguinte num modo que pode já ter mudado.
   */
  private readonly controlSettledSignal = signal(false);

  /**
   * Última resposta do serviço sobre a liberação; `undefined` até a primeira chegar.
   */
  readonly startReleased = this.startReleasedSignal.asReadonly();

  /**
   * Último `preCodigo` lido. Sem resposta nenhuma do serviço, **sem** código: para a pesquisa, o
   * erro seguro é o estudante escrever do zero, não ver o programa que o condutor escondeu (teste
   * de 02/11: com a chave desligada e o serviço mudo, o cenário abria com o código). Para
   * pré-visualizar o próximo cenário; o **Iniciar** usa `controlForStart`.
   */
  readonly showStarterCode = computed(() => this.starterCodeReadSignal() ?? false);

  /**
   * Se o modo do próximo cenário já está confirmado. Durante a tarefa o painel pode ter mudado o
   * pré-código sem a aba saber (o polling do controle para enquanto a tarefa corre); no fim dela
   * a barra mostrava ~1 s o enunciado no modo antigo e só depois o novo (teste de 02/11).
   */
  readonly controlSettled = this.controlSettledSignal.asReadonly();

  start(): void {
    if (typeof window === "undefined" || this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
      if (!this.studySession.isRunning()) {
        void this.refreshControl();
      }
    }, POLL_INTERVAL_MS);
    // Uma aba que recarrega (ou entra depois do «Liberar início») não espera a primeira volta.
    void this.refreshControl();
    // Fim de tarefa: o que se leu antes dela pode estar velho; a pré-visualização espera a releitura.
    this.studySession.lifecycle$.pipe(takeUntilDestroyed(this.lifetime)).subscribe(event => {
      if (event.kind === "ended") {
        this.controlSettledSignal.set(false);
        void this.refreshControl();
      }
    });
    this.lifetime.onDestroy(() => {
      clearInterval(this.timer);
      this.timer = undefined;
    });
  }

  /**
   * Fim do participante, pela barra ou pelo painel: envia o que falta, apaga o código das abas
   * e as preferências do tutor, e recarrega no formulário.
   */
  async endSessionAndReload(): Promise<void> {
    await this.telemetry.endSession();
    this.workspace.forgetAll();
    this.tutorSettings.forgetParticipant();
    globalThis.location.reload();
  }

  /**
   * Relê o controle e devolve o `preCodigo` a usar no cenário que vai começar. Sem resposta a
   * tempo, fica o último valor conhecido (sem nenhum, sem código).
   */
  async controlForStart(): Promise<{ starterCode: boolean }> {
    // Corrida com um teto curto: se o polling já tinha um pedido lento no ar, não se espera por ele.
    await Promise.race([
      this.refreshControl(),
      new Promise<void>(resolve => {
        setTimeout(resolve, START_CONTROL_TIMEOUT_MS);
      }),
    ]);
    return { starterCode: this.showStarterCode() };
  }

  /**
   * Lê `GET /coleta/controle`. Só com a barra em uso (participante ou modo teste): a IDE pública
   * não faz pedido nenhum. Pedidos simultâneos partilham o mesmo `fetch`. Ao terminar, com ou
   * sem resposta, o modo fica dado como confirmado: sem resposta vale o último lido (ou sem
   * código), em vez de deixar a barra presa num «Carregando».
   */
  refreshControl(): Promise<void> {
    const baseUrl = apiBaseUrl();
    if (!baseUrl || !(this.studySession.isStudySession() || this.studySession.isTestMode())) {
      this.controlSettledSignal.set(true);
      return Promise.resolve();
    }
    this.controlRequest ??= this.fetchControl(baseUrl).finally(() => {
      this.controlRequest = undefined;
      this.controlSettledSignal.set(true);
    });
    return this.controlRequest;
  }

  private async fetchControl(baseUrl: string): Promise<void> {
    try {
      // Sem cabeçalhos próprios: pedido simples, sem preflight, como o de comandos.
      const response = await fetch(`${baseUrl}/coleta/controle`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        return;
      }
      const control = parseStudyControl(await response.json());
      if (control === undefined) {
        return;
      }
      this.startReleasedSignal.set(control.inicioLiberado);
      this.starterCodeReadSignal.set(control.preCodigo);
    } catch {
      // Rede instável: fica o último valor; a próxima volta tenta de novo.
    }
  }

  private async poll(): Promise<void> {
    const sessionId = this.telemetry.collectingSessionId;
    const baseUrl = environment.agentApiBaseUrl?.trim().replace(/\/+$/, "");
    if (!baseUrl || sessionId === undefined || this.polling || !this.studySession.isStudySession()) {
      return;
    }
    this.polling = true;
    try {
      const params = new URLSearchParams({ sessionId, after: this.readLastCommand() });
      const response = await fetch(`${baseUrl}/coleta/comandos?${params}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return;
      }
      const { commands } = (await response.json()) as { commands?: ConductorCommand[] };
      if (!commands) {
        return;
      }
      for (const command of commands) {
        await this.apply(command);
      }
    } catch {
      // Rede instável: a próxima volta tenta de novo.
    } finally {
      this.polling = false;
    }
  }

  private async apply(command: ConductorCommand): Promise<void> {
    this.writeLastCommand(command.id);
    this.telemetry.logConductorCommand(command.id, command.kind, command.minutes);

    switch (command.kind) {
      case "extend": {
        this.studySession.extendTask((command.minutes ?? 5) * 60_000);
        break;
      }
      case "accept": {
        this.studySession.endTask("solved", "conductor");
        break;
      }
      case "skip": {
        this.studySession.endTask("aborted", "conductor");
        break;
      }
      case "end_session": {
        // O id já está gravado: depois do recarregamento a aba é outra sessão, mas não custa.
        await this.endSessionAndReload();
        break;
      }
      default: {
        break;
      }
    }
  }

  private readLastCommand(): string {
    try {
      return sessionStorage.getItem(LAST_COMMAND_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private writeLastCommand(id: string): void {
    try {
      sessionStorage.setItem(LAST_COMMAND_KEY, id);
    } catch {
      // modo privado
    }
  }
}

function apiBaseUrl(): string | undefined {
  return environment.agentApiBaseUrl?.trim().replace(/\/+$/, "") || undefined;
}
