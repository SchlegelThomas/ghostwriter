import { GhostwriterApiError, type CaptureSummaryResponse } from "./api.js";

export const INBOX_LOAD_FAILURE_GENERIC =
  "Ghostwriter could not load the Inbox." as const;

export const INBOX_ARCHIVE_FAILURE_GENERIC =
  "Ghostwriter could not update this Capture." as const;

export type InboxPanelActivity = "idle" | "loading" | "problem";

export type InboxPanelProblemEvent = Readonly<{
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "error";
}>;

export type InboxPanelAcknowledgementEvent = Readonly<{
  kind: "archive" | "restore";
  title: string;
  detail: string;
}>;

export type InboxLoadPhase = "loading" | "failure" | "empty" | "ready";

export function messageForInboxLoadFailure(_cause: unknown): string {
  if (_cause instanceof GhostwriterApiError && _cause.status === 401) {
    return "Your session ended. Sign in again before opening the Inbox.";
  }
  return INBOX_LOAD_FAILURE_GENERIC;
}

export function messageForInboxArchiveFailure(_cause: unknown): string {
  if (_cause instanceof GhostwriterApiError && _cause.status === 401) {
    return "Your session ended. Sign in again before updating this Capture.";
  }
  return INBOX_ARCHIVE_FAILURE_GENERIC;
}

export function formatCaptureUpdatedTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString();
}

export function captureInboxRowTitle(summary: CaptureSummaryResponse): string {
  return `Untitled Capture · ${formatCaptureUpdatedTime(summary.updatedAt)}`;
}

export function captureInboxModalityLabel(
  modality: CaptureSummaryResponse["sourceModality"]
): string {
  return modality === "dictation" ? "Dictation" : "Typed text";
}

export function captureInboxStatusLabel(
  status: CaptureSummaryResponse["status"]
): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "integrated":
      return "Integrated";
    case "archived":
      return "Archived";
    default:
      return "Draft";
  }
}

export function captureInboxMetaLine(summary: CaptureSummaryResponse): string {
  return [
    captureInboxModalityLabel(summary.sourceModality),
    `Acknowledged v${summary.workingVersion}`,
    formatCaptureUpdatedTime(summary.updatedAt),
    captureInboxStatusLabel(summary.status)
  ].join(" · ");
}

export function captureInboxIntegratedNote(
  summary: CaptureSummaryResponse
): string | undefined {
  if (summary.status !== "integrated") {
    return undefined;
  }
  const parts = ["Integrated into Draft"];
  if (summary.integratedSceneId !== undefined) {
    parts.push(`target scene ${summary.integratedSceneId}`);
  }
  if (summary.integratedAt !== undefined) {
    parts.push(formatCaptureUpdatedTime(summary.integratedAt));
  }
  return parts.join(" · ");
}

export function captureInboxIsReadOnly(summary: CaptureSummaryResponse): boolean {
  return summary.status === "integrated" || summary.status === "archived";
}

export function captureInboxCanArchive(summary: CaptureSummaryResponse): boolean {
  if (summary.status === "integrated" || summary.status === "archived") {
    return false;
  }
  return summary.workingVersion > 1;
}

export function captureInboxCanRestore(summary: CaptureSummaryResponse): boolean {
  return summary.status === "archived" || summary.archivedAt !== undefined;
}

export function inboxLoadPhase(input: Readonly<{
  loading: boolean;
  loadFailed: boolean;
  captureCount: number;
}>): InboxLoadPhase {
  if (input.loading) return "loading";
  if (input.loadFailed) return "failure";
  if (input.captureCount === 0) return "empty";
  return "ready";
}

export function inboxPanelActivity(input: Readonly<{
  loading: boolean;
  loadFailed: boolean;
  rowActionBusy: boolean;
  handoffBusy?: boolean;
  reflectionBusy?: boolean;
}>): InboxPanelActivity {
  if (input.loadFailed) return "problem";
  if (
    input.loading ||
    input.rowActionBusy ||
    input.handoffBusy === true ||
    input.reflectionBusy === true
  ) {
    return "loading";
  }
  return "idle";
}

/** Blocks Inbox controls that would change the active Capture during handoff/archive/load. */
export function inboxCaptureSessionControlsDisabled(input: Readonly<{
  loading: boolean;
  rowActionBusy: boolean;
  handoffBusy: boolean;
  reflectionBusy?: boolean;
}>): boolean {
  return (
    input.loading ||
    input.rowActionBusy ||
    input.handoffBusy ||
    input.reflectionBusy === true
  );
}

export function captureInboxCanRequestReflection(
  head: Readonly<{ status: CaptureSummaryResponse["status"] }> | undefined
): boolean {
  return head !== undefined && (head.status === "draft" || head.status === "ready");
}

export function inboxPanelProblemEvents(input: Readonly<{
  projectId: string;
  loadFailed: boolean;
  loadFailureMessage?: string;
  rowFailure?: Readonly<{ captureId: string; message: string }>;
}>): readonly InboxPanelProblemEvent[] {
  const events: InboxPanelProblemEvent[] = [];
  if (input.loadFailed) {
    events.push({
      id: `inbox-load:${input.projectId}`,
      title: "Inbox could not load",
      detail: input.loadFailureMessage ?? INBOX_LOAD_FAILURE_GENERIC,
      tone: "error"
    });
  }
  if (input.rowFailure !== undefined) {
    events.push({
      id: `inbox-archive:${input.rowFailure.captureId}`,
      title: "Capture could not update",
      detail: input.rowFailure.message,
      tone: "warning"
    });
  }
  return events;
}

export function acknowledgementForInboxArchive(
  archived: boolean
): InboxPanelAcknowledgementEvent {
  return archived
    ? {
        kind: "archive",
        title: "Capture archived",
        detail: "The Capture stays in your project and can be restored from archived Inbox."
      }
    : {
        kind: "restore",
        title: "Capture restored",
        detail: "The Capture returned to your active Inbox."
      };
}
