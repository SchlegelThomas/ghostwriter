import type { StoryWorkAssignment } from "@ghostwriter/core";
import { GhostwriterApiError, type StoryWorkRecoveryProjection } from "./api.js";

export type StoryWorkReloadRecoveryActions = Readonly<{
  refresh: boolean;
  cancel: boolean;
  markInterrupted: boolean;
}>;

export type StoryWorkReloadRecoveryPresentation = Readonly<{
  message: string;
  technicalRunId?: string;
  actions: StoryWorkReloadRecoveryActions;
  cancelAccessibilityHint: string;
}>;

export type StoryWorkTerminalOutcomePresentation = Readonly<{
  statusLine: string;
  showRetry: boolean;
}>;

const UNCERTAIN_AFTER_RELOAD_MESSAGE =
  "Generation may still be active or the provider outcome may be uncertain after reload. Refresh status before canceling or marking interrupted.";

const CANCEL_PROVIDER_HINT =
  "Provider usage may already have occurred; your story stays unchanged.";

export function presentStoryWorkReloadRecovery(input: Readonly<{
  assignmentStatus: StoryWorkAssignment["status"];
  recovery?: StoryWorkRecoveryProjection;
  runId?: string;
}>): StoryWorkReloadRecoveryPresentation | undefined {
  if (input.assignmentStatus !== "running" && input.recovery === undefined) {
    return undefined;
  }
  const active = input.recovery?.status === "active-or-interrupted";
  const message = input.recovery?.message ?? UNCERTAIN_AFTER_RELOAD_MESSAGE;
  const technicalRunId =
    active && input.recovery !== undefined
      ? input.recovery.runId
      : input.recovery?.runId ?? input.runId;
  return Object.freeze({
    message,
    ...(technicalRunId === undefined ? {} : { technicalRunId }),
    actions: Object.freeze({
      refresh: true,
      cancel: active,
      markInterrupted: active
    }),
    cancelAccessibilityHint: CANCEL_PROVIDER_HINT
  });
}

export function presentStoryWorkTerminalOutcome(input: Readonly<{
  assignmentStatus: StoryWorkAssignment["status"];
  terminalDiagnosticCode?: string;
}>): StoryWorkTerminalOutcomePresentation | undefined {
  if (input.assignmentStatus === "running") {
    return undefined;
  }
  switch (input.terminalDiagnosticCode) {
    case "client-interrupted":
      return Object.freeze({
        statusLine:
          "You marked this generation interrupted after reload. Ghostwriter did not restart it or apply anything to your story. Use Try another generation when you are ready.",
        showRetry: true
      });
    case "run-canceled":
      return Object.freeze({
        statusLine:
          "This generation was canceled. Provider usage may already have occurred; your story is unchanged.",
        showRetry: true
      });
    case "provider-timeout":
      return Object.freeze({
        statusLine:
          "The provider stopped responding before a draft was ready. Your story is unchanged.",
        showRetry: true
      });
    case "provider-rate-limited":
      return Object.freeze({
        statusLine:
          "The provider rate-limited this generation before a draft was ready. Your story is unchanged.",
        showRetry: true
      });
    case "provider-malformed-output":
      return Object.freeze({
        statusLine:
          "The provider returned output Ghostwriter could not turn into a draft. Your story is unchanged.",
        showRetry: true
      });
    case "provider-unavailable":
      return Object.freeze({
        statusLine:
          "The provider was unavailable before a draft was ready. Your story is unchanged.",
        showRetry: true
      });
    case "context-stale":
      return Object.freeze({
        statusLine:
          "Sources changed before this generation finished. Refresh the assignment, then retry with current story context.",
        showRetry: true
      });
    case "internal-failure":
      return Object.freeze({
        statusLine:
          "Ghostwriter could not finish this generation. Your story is unchanged.",
        showRetry: true
      });
    default:
      if (
        input.assignmentStatus === "failed" ||
        input.assignmentStatus === "canceled" ||
        input.assignmentStatus === "stale"
      ) {
        return Object.freeze({
          statusLine: "This generation stopped without a reviewable draft. Your story is unchanged.",
          showRetry: true
        });
      }
      return undefined;
  }
}

export function storyWorkNonReviewableStatusLine(input: Readonly<{
  assignmentStatus: StoryWorkAssignment["status"];
  terminalDiagnosticCode?: string;
}>): string {
  const terminal = presentStoryWorkTerminalOutcome(input);
  if (terminal !== undefined) return terminal.statusLine;
  if (input.assignmentStatus === "running") {
    return presentStoryWorkReloadRecovery({
      assignmentStatus: input.assignmentStatus,
      runId: undefined
    })!.message;
  }
  return "No reviewable artifact is available yet.";
}

export function storyWorkRecoverySuccessMessage(
  action: "cancel" | "mark-interrupted",
  replayed: boolean
): string {
  if (replayed) {
    return action === "cancel"
      ? "Generation was already canceled."
      : "Generation was already marked interrupted.";
  }
  return action === "cancel"
    ? "Generation canceled."
    : "Generation marked interrupted.";
}

export function messageForStoryWorkRecoveryFailure(cause: unknown): string {
  if (cause instanceof GhostwriterApiError) {
    if (cause.status === 409) {
      return `${cause.message} Refresh status, then try again.`;
    }
    if (cause.status === 404) {
      return "This story work assignment is unavailable. Refresh story work and try again.";
    }
  }
  return cause instanceof Error
    ? cause.message
    : "The recovery action could not be completed.";
}

export function storyWorkReloadRecoveryShowsRetry(input: Readonly<{
  assignmentStatus: StoryWorkAssignment["status"];
  terminalDiagnosticCode?: string;
}>): boolean {
  const terminal = presentStoryWorkTerminalOutcome(input);
  if (terminal !== undefined) return terminal.showRetry;
  return ["brief-ready", "failed", "canceled", "stale"].includes(input.assignmentStatus);
}
