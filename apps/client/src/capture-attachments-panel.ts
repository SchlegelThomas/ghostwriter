import {
  CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS,
  type CaptureAttachmentRefusalCode,
  type CaptureAttachmentState
} from "@ghostwriter/core";
import type { CaptureHeadResponse } from "./api.js";
import type { CaptureAttachmentUploadProgress } from "./capture-attachment-upload.js";
import {
  captureComposerActivity,
  captureComposerProblemEvents,
  captureSaveStatusIsWarning,
  captureSaveStatusText,
  type CaptureComposerActivity,
  type CaptureComposerProblem,
  type CaptureComposerProblemEvent
} from "./capture-composer.js";
import type { SceneSaveQueueSnapshot } from "./scene-save-queue.js";

export const CAPTURE_ATTACHMENT_LIST_FAILURE_GENERIC =
  "Ghostwriter could not load Capture attachments." as const;

export const CAPTURE_ATTACHMENT_ACTION_FAILURE_GENERIC =
  "Ghostwriter could not update this attachment." as const;

export const CAPTURE_ATTACHMENT_UPLOAD_FAILURE_GENERIC =
  "Ghostwriter could not attach this file." as const;

export const CAPTURE_ATTACHMENT_DOWNLOAD_FAILURE_GENERIC =
  "Ghostwriter could not open this attachment." as const;

export const CAPTURE_ATTACHMENT_FILE_PICKER_UNAVAILABLE_COPY =
  "File attachments are unavailable in this environment." as const;

/** Keeps attachment rows reachable inside the height-bounded Capture modal. */
export const CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS = {
  minHeight: 72,
  maxHeight: 240
} as const;

export function captureAttachmentListScrollStyle(): Readonly<{
  minHeight: number;
  maxHeight: number;
  flexGrow: 0;
  flexShrink: 1;
}> {
  return {
    minHeight: CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.minHeight,
    maxHeight: CAPTURE_ATTACHMENT_LIST_SCROLL_BOUNDS.maxHeight,
    flexGrow: 0,
    flexShrink: 1
  };
}

export const CAPTURE_ATTACHMENT_RECORDING_STATUS_COPY = {
  recording: "Recording audio…",
  stopping: "Finishing recording…"
} as const;

export type CaptureAttachmentActivity = "idle" | "uploading" | "recording" | "problem";

export type CaptureAttachmentDeleteConfirm = (
  message: string
) => Promise<boolean>;

export type CaptureAttachmentPanelLoadPhase =
  | "idle"
  | "loading"
  | "failure"
  | "empty"
  | "ready";

export function captureAttachmentsAddAllowed(
  head: CaptureHeadResponse | undefined,
  forcedReadOnly = false
): boolean {
  if (forcedReadOnly) return false;
  if (head === undefined) return false;
  return head.status === "draft" || head.status === "ready";
}

export function buildCaptureAttachmentFileInputAccept(): string {
  return Object.keys(CAPTURE_ATTACHMENT_ALLOWED_MIME_BYTE_LIMITS).join(",");
}

export function isCaptureFilePickerAvailable(
  host: Readonly<{ document?: Pick<Document, "createElement"> }> = globalThis
): boolean {
  return typeof host.document?.createElement === "function";
}

export function captureAttachmentStateLabel(state: CaptureAttachmentState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "ready":
      return "Ready";
    case "refused":
      return "Refused";
    case "deleted":
      return "Deleted";
    default:
      return "Unknown";
  }
}

export function captureAttachmentRefusalLabel(
  code: CaptureAttachmentRefusalCode | undefined
): string | undefined {
  if (code === undefined) return undefined;
  switch (code) {
    case "unsupported-type":
      return "This file type is not allowed.";
    case "declared-size-exceeded":
      return "This file exceeds the allowed size.";
    case "type-mismatch":
      return "The file type did not match what was declared.";
    case "size-mismatch":
      return "The file size did not match what was declared.";
    case "checksum-mismatch":
      return "The file could not be verified after upload.";
    case "object-missing":
      return "The stored original is missing.";
    case "inspection-failed":
      return "The file could not be safely inspected.";
    default:
      return "This attachment was refused.";
  }
}

export function formatCaptureAttachmentByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

export function captureAttachmentMimeLabel(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "JPEG image";
    case "image/png":
      return "PNG image";
    case "image/webp":
      return "WebP image";
    case "audio/webm":
      return "WebM audio";
    case "audio/mp4":
      return "M4A audio";
    case "audio/mpeg":
      return "MP3 audio";
    case "application/pdf":
      return "PDF";
    case "text/plain":
      return "Plain text";
    default:
      return "File";
  }
}

export function captureAttachmentPendingExpiryLabel(
  pendingExpiresAt: string | undefined
): string | undefined {
  if (pendingExpiresAt === undefined) return undefined;
  const date = new Date(pendingExpiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Upload must finish by ${date.toLocaleString()}`;
}

export function captureAttachmentCanDownload(state: CaptureAttachmentState): boolean {
  return state === "ready";
}

export function captureAttachmentCanDelete(state: CaptureAttachmentState): boolean {
  return state !== "deleted";
}

export function captureAttachmentAddControlsDisabled(input: Readonly<{
  attachmentsEditable: boolean;
  activity: CaptureAttachmentActivity;
  listLoading: boolean;
  uploadBusy: boolean;
  filePickerAvailable: boolean;
}>): boolean {
  if (!input.attachmentsEditable) return true;
  if (input.listLoading) return true;
  if (input.uploadBusy) return true;
  if (input.activity === "uploading" || input.activity === "recording") return true;
  return false;
}

export function captureAttachmentFilePickerDisabled(input: Readonly<{
  addControlsDisabled: boolean;
  filePickerAvailable: boolean;
}>): boolean {
  return input.addControlsDisabled || !input.filePickerAvailable;
}

export function captureAttachmentRecordControlsDisabled(input: Readonly<{
  addControlsDisabled: boolean;
  recorderAvailable: boolean;
}>): boolean {
  return input.addControlsDisabled || !input.recorderAvailable;
}

export function captureAttachmentUploadProgressPercent(
  progress: CaptureAttachmentUploadProgress | undefined
): number | undefined {
  if (progress === undefined || progress.total <= 0) return undefined;
  const raw = Math.round((progress.loaded / progress.total) * 100);
  return Math.min(100, Math.max(0, raw));
}

export function monotonicCaptureAttachmentUploadPercent(
  previous: number | undefined,
  next: number | undefined
): number | undefined {
  if (next === undefined) return previous;
  if (previous === undefined) return next;
  return Math.max(previous, next);
}

export function captureAttachmentPanelLoadPhase(input: Readonly<{
  captureId: string | undefined;
  loading: boolean;
  loadFailed: boolean;
  attachmentCount: number;
}>): CaptureAttachmentPanelLoadPhase {
  if (input.captureId === undefined) return "idle";
  if (input.loading) return "loading";
  if (input.loadFailed) return "failure";
  if (input.attachmentCount === 0) return "empty";
  return "ready";
}

export function captureAttachmentActivityFromPanel(input: Readonly<{
  listFailed: boolean;
  actionProblem: boolean;
  uploadActive: boolean;
  recordingActive: boolean;
}>): CaptureAttachmentActivity {
  if (input.listFailed || input.actionProblem) return "problem";
  if (input.uploadActive) return "uploading";
  if (input.recordingActive) return "recording";
  return "idle";
}

export function mergeCaptureComposerActivity(
  prose: CaptureComposerActivity,
  attachment: CaptureAttachmentActivity
): CaptureComposerActivity {
  if (prose === "problem" || attachment === "problem") return "problem";
  if (
    prose === "saving" ||
    attachment === "uploading" ||
    attachment === "recording"
  ) {
    return "saving";
  }
  return "idle";
}

export function captureAttachmentSaveStatusOverride(input: Readonly<{
  attachmentActivity: CaptureAttachmentActivity;
  uploadFilename?: string;
  uploadPercent?: number;
}>): string | undefined {
  if (input.attachmentActivity === "recording") {
    return CAPTURE_ATTACHMENT_RECORDING_STATUS_COPY.recording;
  }
  if (input.attachmentActivity !== "uploading") return undefined;
  const name = input.uploadFilename ?? "attachment";
  const percent =
    input.uploadPercent === undefined ? undefined : `${input.uploadPercent}%`;
  return percent === undefined
    ? `Uploading ${name}…`
    : `Uploading ${name}… ${percent}`;
}

export function captureComposerSaveStatusText(input: Readonly<{
  snapshot: SceneSaveQueueSnapshot | undefined;
  problem: CaptureComposerProblem | undefined;
  recoveryOffer: boolean;
  attachmentActivity?: CaptureAttachmentActivity;
  uploadFilename?: string;
  uploadPercent?: number;
}>): string {
  const attachmentOverride = captureAttachmentSaveStatusOverride({
    attachmentActivity: input.attachmentActivity ?? "idle",
    uploadFilename: input.uploadFilename,
    uploadPercent: input.uploadPercent
  });
  if (attachmentOverride !== undefined) {
    return attachmentOverride;
  }
  return captureSaveStatusText(
    input.snapshot,
    input.problem,
    input.recoveryOffer
  );
}

export function captureComposerSaveStatusIsWarning(input: Readonly<{
  snapshot: SceneSaveQueueSnapshot | undefined;
  problem: CaptureComposerProblem | undefined;
  recoveryOffer: boolean;
  attachmentActivity?: CaptureAttachmentActivity;
}>): boolean {
  if (
    input.attachmentActivity === "uploading" ||
    input.attachmentActivity === "recording"
  ) {
    return false;
  }
  return captureSaveStatusIsWarning(
    input.snapshot,
    input.problem,
    input.recoveryOffer
  );
}

export function captureComposerMergedActivity(input: Readonly<{
  snapshot: SceneSaveQueueSnapshot | undefined;
  problem: CaptureComposerProblem | undefined;
  recoveryOffer: boolean;
  initializing: boolean;
  attachmentActivity?: CaptureAttachmentActivity;
}>): CaptureComposerActivity {
  const prose = captureComposerActivity(
    input.snapshot,
    input.problem,
    input.recoveryOffer,
    input.initializing
  );
  return mergeCaptureComposerActivity(
    prose,
    input.attachmentActivity ?? "idle"
  );
}

export function captureAttachmentProblemId(captureId: string): string {
  return `capture-attachment:${captureId}`;
}

export function captureAttachmentProblemEvents(input: Readonly<{
  captureId: string;
  listFailed: boolean;
  listFailureMessage?: string;
  actionFailureMessage?: string;
}>): readonly CaptureComposerProblemEvent[] {
  const events: CaptureComposerProblemEvent[] = [];
  if (input.listFailed) {
    events.push({
      id: captureAttachmentProblemId(input.captureId),
      title: "Capture attachments could not load",
      detail: input.listFailureMessage ?? CAPTURE_ATTACHMENT_LIST_FAILURE_GENERIC,
      tone: "error"
    });
  } else if (input.actionFailureMessage !== undefined) {
    events.push({
      id: captureAttachmentProblemId(input.captureId),
      title: "Capture attachment problem",
      detail: input.actionFailureMessage,
      tone: "warning"
    });
  }
  return events;
}

export function captureComposerProblemEventsWithAttachments(input: Readonly<{
  captureId: string;
  recoveryOffer: boolean;
  recoveryMode: import("./capture-recovery.js").CaptureRecoveryStorageMode | undefined;
  problem: CaptureComposerProblem | undefined;
  attachmentListFailed: boolean;
  attachmentListFailureMessage?: string;
  attachmentActionFailureMessage?: string;
}>): readonly CaptureComposerProblemEvent[] {
  return [
    ...captureComposerProblemEvents({
      captureId: input.captureId,
      recoveryOffer: input.recoveryOffer,
      recoveryMode: input.recoveryMode,
      problem: input.problem
    }),
    ...captureAttachmentProblemEvents({
      captureId: input.captureId,
      listFailed: input.attachmentListFailed,
      listFailureMessage: input.attachmentListFailureMessage,
      actionFailureMessage: input.attachmentActionFailureMessage
    })
  ];
}

export async function confirmCaptureAttachmentDelete(
  displayFilename: string,
  confirm: CaptureAttachmentDeleteConfirm
): Promise<boolean> {
  return confirm(
    `Remove “${displayFilename}” from this Capture? The original will be deleted and cannot be recovered from Ghostwriter.`
  );
}

export function messageForCaptureAttachmentListFailure(_cause: unknown): string {
  return CAPTURE_ATTACHMENT_LIST_FAILURE_GENERIC;
}

export function messageForCaptureAttachmentUploadFailure(_cause: unknown): string {
  return CAPTURE_ATTACHMENT_UPLOAD_FAILURE_GENERIC;
}

export function messageForCaptureAttachmentActionFailure(_cause: unknown): string {
  return CAPTURE_ATTACHMENT_ACTION_FAILURE_GENERIC;
}
