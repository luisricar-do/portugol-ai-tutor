import { Injectable } from "@angular/core";

/**
 * Contexto do editor da aba ativa, registado por {@link TabEditorComponent}
 * para o overlay do tutor usar o código e erros corretos.
 */
export interface TutorEditorContextHandle {
  /** Código espelhado da aba (sincroniza com o modelo Angular). */
  getEditorCode: () => string;
  /** Snapshot direto do Monaco no momento do envio. */
  getEditorCodeSnapshot: () => string;
  /** Erros do compilador no momento do envio. */
  getCompilerErrors: () => Promise<string[]>;
  /** Linha 1-based do cursor (Monaco), se existir. */
  getCursorLine?: () => number | undefined;
  /** Coluna 1-based do cursor (Monaco), se existir. */
  getCursorColumn?: () => number | undefined;
  /** Resumo textual curto para o backend (ex.: contagem de erros). */
  getAstSummary?: () => string | undefined;
  /** Contexto do mapa de fluxo (variável pendente, ligações desenhadas). */
  getDataFlowContext?: () => string | undefined;
  /** Linhas 1-based com erro de compilação (marcadores Monaco / worker), para o payload e glifos. */
  getCompilerErrorLines?: () => number[];
}

@Injectable({ providedIn: "root" })
export class TutorEditorContextService {
  private active: TutorEditorContextHandle | null = null;

  register(handle: TutorEditorContextHandle): void {
    this.active = handle;
  }

  unregister(handle: TutorEditorContextHandle): void {
    if (this.active === handle) {
      this.active = null;
    }
  }

  getActive(): TutorEditorContextHandle | null {
    return this.active;
  }
}
