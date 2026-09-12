export {
  TUTOR_CHAT_PLACEHOLDER_CODE,
  TutorAgentError,
  createTutorAgentClient,
  normalizeAgentBaseUrl,
} from "./client.js";
export type { CreateTutorAgentClientOptions, TutorAgentClient } from "./client.js";
export { createTelemetryQueue, telemetryStorageKey } from "./telemetry.js";
export { classifyErrorMessage, summarizeErrorClasses } from "./telemetry-error-class.js";
export type { TelemetryErrorClass } from "./telemetry-error-class.js";
export type {
  CreateTelemetryQueueOptions,
  TelemetryEnvelope,
  TelemetryEventInput,
  TelemetryQueue,
  TelemetryQueuedEvent,
  TelemetryStorage,
} from "./telemetry.js";
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
  TutorTutorMeta,
} from "./types.js";
