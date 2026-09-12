export type TutorHistoryRole = "user" | "assistant";

export interface TutorHistoryItem {
  role: TutorHistoryRole;
  content: string;
}

export interface TutorHelpRequest {
  code: string;
  errors: string[];
  history: TutorHistoryItem[];
  /**
   * Quantidade de decorações do tutor ainda visíveis no editor (destaques, variáveis, comentários inline).
   * O agente usa para decidir se chama `clear_highlights` antes de novas ações.
   */
  activeTutorDecorations?: number;
  /** 1 = dica vaga, 3 = quase direta (pedido explícito de mais ajuda). */
  hintLevel?: number;
  /** Nome do aluno para personalização (ex.: saudação no chat). */
  studentName?: string;
  /** Linha 1-based do cursor no Monaco (se disponível). */
  cursorLine?: number;
  /** Coluna 1-based do cursor no Monaco (se disponível). */
  cursorColumn?: number;
  /** Resumo textual opcional do contexto sintático (frontend / AST). */
  astSummary?: string;
  /** Mapa de fluxo / variáveis em atenção gerado na IDE (cordas, pendências). */
  dataFlowContext?: string;
  /**
   * Linhas 1-based com erro de compilação/análise no momento do pedido (Monaco / worker),
   * para correlação espacial no SMA sem expor o texto bruto ao aluno na UI.
   */
  compilerErrorLines?: number[];
  /**
   * Identificador de sessão gerado pela IDE (`[A-Za-z0-9_-]`, até 64 caracteres). É a chave do
   * registro estruturado por turno no serviço; o nome do aluno nunca entra nesse registro.
   */
  sessionId?: string;
  /** Estado do código no turno anterior do tutor (classificação do movimento do estudante). */
  previousCode?: string;
  /** Erros do compilador no turno anterior, par de `previousCode`. */
  previousErrors?: string[];
}

export interface TutorDiagnosis {
  errorType?: string;
  errorLine?: number | null;
  affectedVariable?: string | null;
  errorDescription?: string;
  hintAngle?: string;
  severity?: string;
  /** Nota opcional do analista sobre fluxo de dados (uso vs declaração). */
  dataFlowHint?: string;
}

export interface TutorHelpErrorBody {
  error: string;
}

/** Ação de editor emitida pelo tutor (SSE `event: action`). */
export interface EditorAction {
  type: string;
  payload: Record<string, unknown>;
}

/** Metadados de política de conversa (ex.: sugestão de encerramento após resolução). */
export interface TutorTutorMeta {
  suggestedConversationEnd?: boolean;
  endReason?: "bug_resolved" | "none" | string;
  /** Rótulo do roteador: `DEBUG`, `THEORY`, `CASUAL` ou `OUT_OF_SCOPE`. */
  intent?: string;
  /**
   * Movimento classificado no turno anterior do estudante (política de contingência):
   * `PROGRESSO`, `ESTAGNACAO`, `REGRESSAO`, `PEDIDO_EXPLICITO` ou `NENHUM`.
   */
  studentMovement?: string;
  /** Modelo que gerou o turno (reprodutibilidade). */
  model?: string;
}

export interface TutorHelpResponse {
  message: string;
  diagnosis: TutorDiagnosis;
  /** Paridade com o fluxo SSE: ações pedagógicas (ex.: destaques, ``mark_bug_resolved``). */
  actions?: EditorAction[];
  tutorMeta?: TutorTutorMeta;
}

/** Payload opcional do evento SSE ``done``. */
export interface TutorStreamDonePayload {
  tutorMeta?: TutorTutorMeta;
}

/** Callbacks para `POST .../help/stream` (SSE: diagnosis, token, action, done, error). */
export interface TutorHelpStreamHandlers {
  onDiagnosis?: (diagnosis: TutorDiagnosis) => void;
  onToken?: (text: string) => void;
  onDone?: (payload?: TutorStreamDonePayload) => void;
  onAction?: (action: EditorAction) => void;
  /** `status` vem do payload SSE (ex.: 400, 500). */
  onError?: (status: number, message: string) => void;
}
