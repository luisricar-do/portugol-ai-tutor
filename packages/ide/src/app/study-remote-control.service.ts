import { DestroyRef, Service, inject } from "@angular/core";

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

  start(): void {
    if (typeof window === "undefined" || this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
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
