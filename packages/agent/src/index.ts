export {
  createTutorAgentClient,
  normalizeAgentBaseUrl,
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError
} from "./client.js";
export type { CreateTutorAgentClientOptions, TutorAgentClient } from "./client.js";
export type {
  TutorDiagnosis,
  TutorHelpErrorBody,
  TutorHelpRequest,
  TutorHelpResponse,
  TutorHelpStreamHandlers,
  TutorHistoryItem,
  TutorHistoryRole
} from "./types.js";

