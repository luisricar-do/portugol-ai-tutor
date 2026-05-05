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
