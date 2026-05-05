export {
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError, createTutorAgentClient,
  normalizeAgentBaseUrl
} from "./client.js";
export type { CreateTutorAgentClientOptions, TutorAgentClient } from "./client.js";
export type {
  EditorAction,
  TutorDiagnosis,
  TutorHelpErrorBody,
  TutorHelpRequest,
  TutorHelpResponse,
  TutorHelpStreamHandlers,
  TutorHistoryItem,
  TutorHistoryRole,
  TutorStreamDonePayload,
  TutorTutorMeta
} from "./types.js";

