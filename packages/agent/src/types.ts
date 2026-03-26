export type TutorHistoryRole = "user" | "assistant";

export interface TutorHistoryItem {
  role: TutorHistoryRole;
  content: string;
}

export interface TutorHelpRequest {
  code: string;
  errors: string[];
  history: TutorHistoryItem[];
}

export interface TutorDiagnosis {
  errorType?: string;
  errorLine?: number | null;
  affectedVariable?: string | null;
  errorDescription?: string;
  hintAngle?: string;
  severity?: string;
}

export interface TutorHelpResponse {
  message: string;
  diagnosis: TutorDiagnosis;
}

export interface TutorHelpErrorBody {
  error: string;
}

/** Ação de editor emitida pelo tutor (SSE `event: action`). */
export interface EditorAction {
  type: string;
  payload: Record<string, unknown>;
}

/** Callbacks para `POST .../help/stream` (SSE: diagnosis, token, action, done, error). */
export interface TutorHelpStreamHandlers {
  onDiagnosis?: (diagnosis: TutorDiagnosis) => void;
  onToken?: (text: string) => void;
  onDone?: () => void;
  onAction?: (action: EditorAction) => void;
  /** `status` vem do payload SSE (ex.: 400, 500). */
  onError?: (status: number, message: string) => void;
}
