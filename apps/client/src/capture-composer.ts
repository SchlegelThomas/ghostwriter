import type { SceneSaveQueueSnapshot } from "./scene-save-queue.js";
import { GhostwriterApiError, type CaptureHeadResponse } from "./api.js";
import type { CaptureRecoveryStorageMode } from "./capture-recovery.js";

export const CAPTURE_DICTATION_LISTENING_COPY =
  "Listening — speech enters the Capture caret." as const;

export const CAPTURE_DICTATION_STATUS_COPY = {
  listening: CAPTURE_DICTATION_LISTENING_COPY
} as const;

export type CaptureComposerActivity = "idle" | "saving" | "problem";

export type CaptureComposerAcknowledgementEvent = Readonly<{
  kind: "save";
  title: string;
  detail: string;
}>;

export type CaptureComposerProblemEvent = Readonly<{
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "error";
}>;

export type CaptureComposerProblem =
  | Readonly<{
      kind: "version";
      message: string;
      serverHead?: CaptureHeadResponse;
    }>
  | Readonly<{ kind: "save" | "load"; message: string }>;

export function isCaptureVersionConflict(cause: unknown): boolean {
  return (
    cause instanceof GhostwriterApiError &&
    cause.code === "CAPTURE_VERSION_CONFLICT"
  );
}

export function captureComposerIsReadOnly(
  head: CaptureHeadResponse | undefined,
  forcedReadOnly = false
): boolean {
  if (forcedReadOnly) return true;
  if (head === undefined) return true;
  return head.status === "archived" || head.status === "integrated";
}

export function captureReadOnlyStatusText(
  head: CaptureHeadResponse | undefined
): string | undefined {
  if (head === undefined) return undefined;
  if (head.status === "archived") return "Read-only · archived Idea Capture";
  if (head.status === "integrated") return "Read-only · integrated Idea Capture";
  return undefined;
}

export function captureSaveStatusText(
  snapshot: SceneSaveQueueSnapshot | undefined,
  problem: CaptureComposerProblem | undefined,
  recoveryOffer: boolean
): string {
  if (snapshot === undefined) return "Loading…";
  if (problem?.kind === "version") return "Capture changed · conflict";
  if (recoveryOffer) return "Not saved · recovery";
  if (snapshot.status === "saving") return "Saving…";
  if (snapshot.status === "pending") return "Waiting to save…";
  if (snapshot.status === "paused" && snapshot.dirty) return "Not saved";
  if (snapshot.dirty) return "Not saved";
  return "";
}

export function captureSaveStatusIsWarning(
  snapshot: SceneSaveQueueSnapshot | undefined,
  problem: CaptureComposerProblem | undefined,
  recoveryOffer: boolean
): boolean {
  if (problem !== undefined) return true;
  if (recoveryOffer) return true;
  return snapshot?.dirty === true || snapshot?.status === "paused";
}

export function messageForCaptureSaveFailure(cause: unknown): string {
  if (cause instanceof GhostwriterApiError && cause.status === 401) {
    return "Your session ended. Sign in again before saving this Capture.";
  }
  return (
    "Ghostwriter could not save this Capture. Your unacknowledged prose remains in recovery."
  );
}

export function messageForCaptureVersionConflict(): string {
  return (
    "This Capture changed elsewhere. Ghostwriter applied nothing and kept your local prose " +
    "in recovery without combining it."
  );
}

export const CAPTURE_LOAD_FAILURE_GENERIC =
  "Ghostwriter could not load this Capture." as const;

export const CAPTURE_LOAD_FAILURE_NOT_FOUND =
  "This Capture could not be found. It may have been removed or you may not have access." as const;

export function messageForCaptureLoadFailure(cause: unknown): string {
  if (cause instanceof GhostwriterApiError && cause.status === 401) {
    return "Your session ended. Sign in again before opening this Capture.";
  }
  if (
    cause instanceof GhostwriterApiError &&
    (cause.code === "CAPTURE_NOT_FOUND" || cause.status === 404)
  ) {
    return CAPTURE_LOAD_FAILURE_NOT_FOUND;
  }
  return CAPTURE_LOAD_FAILURE_GENERIC;
}

export function captureComposerActivity(
  snapshot: SceneSaveQueueSnapshot | undefined,
  problem: CaptureComposerProblem | undefined,
  recoveryOffer: boolean,
  initializing: boolean
): CaptureComposerActivity {
  if (problem !== undefined || recoveryOffer) return "problem";
  if (
    initializing ||
    snapshot === undefined ||
    snapshot.status === "pending" ||
    snapshot.status === "saving"
  ) {
    return "saving";
  }
  return "idle";
}

export function captureComposerProblemEvents(input: Readonly<{
  captureId: string;
  recoveryOffer: boolean;
  recoveryMode: CaptureRecoveryStorageMode | undefined;
  problem: CaptureComposerProblem | undefined;
}>): readonly CaptureComposerProblemEvent[] {
  const events: CaptureComposerProblemEvent[] = [];
  if (input.recoveryOffer) {
    events.push({
      id: `capture-recovery:${input.captureId}`,
      title: "Unsaved Capture recovered",
      detail:
        "Local prose differs from the acknowledged project Capture. Review Recover or Discard in the composer.",
      tone: "warning"
    });
  }
  if (input.recoveryMode === "tab-only") {
    events.push({
      id: `capture-recovery-storage:${input.captureId}`,
      title: "Browser recovery is limited",
      detail:
        "New unacknowledged prose is protected only while this tab remains open.",
      tone: "warning"
    });
  }
  if (input.problem !== undefined) {
    events.push({
      id: `capture-problem:${input.captureId}`,
      title:
        input.problem.kind === "version"
          ? "Capture version conflict"
          : input.problem.kind === "save"
            ? "Capture not saved"
            : "Capture could not load",
      detail: input.problem.message,
      tone: input.problem.kind === "load" ? "error" : "warning"
    });
  }
  return events;
}

export function mapCaptureSaveFailureToProblem(
  cause: unknown
): CaptureComposerProblem {
  if (isCaptureVersionConflict(cause)) {
    return {
      kind: "version",
      message: messageForCaptureVersionConflict()
    };
  }
  return {
    kind: "save",
    message: messageForCaptureSaveFailure(cause)
  };
}
