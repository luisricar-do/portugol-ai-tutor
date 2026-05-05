import { Injectable, signal } from "@angular/core";

/** Uma conexão de fluxo de dados (corda fantasma) entre duas linhas. */
export interface TutorDataFlowConnection {
  fromLine: number;
  fromVar: string;
  toLine: number;
  toVar: string;
  status: "ok" | "broken";
}

@Injectable({ providedIn: "root" })
export class TutorImmersionService {
  /** Modo foco: escurece o editor (dimming). */
  private readonly focusModeSignal = signal(false);

  /** Linha com contorno pulsante (erro / atenção). */
  private readonly pulsingLineSignal = signal<number | null>(null);

  /** Conexões para o mapa visual de fluxo. */
  private readonly dataFlowConnectionsSignal = signal<TutorDataFlowConnection[]>([]);

  /** Variável ainda “quebrada” no fluxo (para validação em tempo real). */
  private readonly pendingBrokenVarSignal = signal<string | null>(null);

  /** Linhas fantasmas mais suaves (HUD em retirada estratégica). */
  private readonly ghostLinesMutedSignal = signal(false);

  readonly focusMode = this.focusModeSignal.asReadonly();
  readonly pulsingLine = this.pulsingLineSignal.asReadonly();
  readonly dataFlowConnections = this.dataFlowConnectionsSignal.asReadonly();
  readonly pendingBrokenVar = this.pendingBrokenVarSignal.asReadonly();
  readonly ghostLinesMuted = this.ghostLinesMutedSignal.asReadonly();

  setFocusMode(on: boolean): void {
    this.focusModeSignal.set(on);
  }

  setPulsingLine(line: number | null): void {
    this.pulsingLineSignal.set(line);
  }

  setDataFlowConnections(connections: TutorDataFlowConnection[]): void {
    this.dataFlowConnectionsSignal.set(connections);
    const broken = connections.find(c => c.status === "broken");
    this.pendingBrokenVarSignal.set(broken?.fromVar ?? broken?.toVar ?? null);
  }

  clearDataFlow(): void {
    this.dataFlowConnectionsSignal.set([]);
    this.pendingBrokenVarSignal.set(null);
  }

  setGhostLinesMuted(on: boolean): void {
    this.ghostLinesMutedSignal.set(on);
  }

  /** Chamado quando o aluno corrige o fluxo (ex.: adicionou leia). */
  resolvePendingFlow(): void {
    const conns = this.dataFlowConnectionsSignal().map(c =>
      c.status === "broken" ? { ...c, status: "ok" as const } : c,
    );
    this.dataFlowConnectionsSignal.set(conns);
    this.pendingBrokenVarSignal.set(null);
    this.focusModeSignal.set(false);
    this.pulsingLineSignal.set(null);
  }

  clearImmersion(): void {
    this.focusModeSignal.set(false);
    this.pulsingLineSignal.set(null);
    this.clearDataFlow();
  }
}
