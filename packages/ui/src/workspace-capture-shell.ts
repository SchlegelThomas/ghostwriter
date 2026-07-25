/** Narrow mode bar labels for Capture / Inbox (checkpoint-1 shell). */
export const NARROW_CAPTURE_TAB_LABEL = "Capture" as const;
export const NARROW_INBOX_TAB_LABEL = "Inbox" as const;

export type WorkspaceShellNavigationAction =
  | "mode-change"
  | "reader"
  | "manuscript-selection"
  | "project-back";

/** Inbox replaces the center work surface; Capture uses a full-screen modal overlay. */
export function inboxTakesCenterWorkspace(inboxOpen: boolean): boolean {
  return inboxOpen;
}

/** Mode, tree, Canvas drill, Reader, and project back should dismiss Inbox. */
export function workspaceNavigationClosesInbox(
  action: WorkspaceShellNavigationAction
): boolean {
  switch (action) {
    case "mode-change":
    case "reader":
    case "manuscript-selection":
    case "project-back":
      return true;
    default:
      return false;
  }
}

export type ProjectChangesIdleInput = Readonly<{
  projectSaveIdle: boolean;
  canvasSaveIdle: boolean;
  draftActivityIdle: boolean;
  captureActivityIdle: boolean;
  inboxActivityIdle: boolean;
  shellBusy: boolean;
  canvasBusy: boolean;
}>;

export function aggregateProjectChangesIdle(
  input: ProjectChangesIdleInput
): boolean {
  return (
    input.projectSaveIdle &&
    input.canvasSaveIdle &&
    input.draftActivityIdle &&
    input.captureActivityIdle &&
    input.inboxActivityIdle &&
    !input.shellBusy &&
    !input.canvasBusy
  );
}

export type CaptureComposerShellActivity = "idle" | "saving" | "problem";

export type CaptureShellActivityInput = Readonly<{
  modalOpen: boolean;
  activity: CaptureComposerShellActivity;
  problemWhileClosed: boolean;
}>;

/** Shell idle: latched closed problems block; open modal follows live activity. */
export function captureShellChangesIdle(
  input: CaptureShellActivityInput
): boolean {
  if (input.problemWhileClosed) return false;
  if (!input.modalOpen) return true;
  return input.activity === "idle";
}

export function finalizeCaptureShellActivityOnClose(
  activity: CaptureComposerShellActivity,
  problemWhileClosed: boolean
): Readonly<{
  activity: CaptureComposerShellActivity;
  problemWhileClosed: boolean;
}> {
  if (problemWhileClosed || activity === "problem") {
    return { activity: "problem", problemWhileClosed: true };
  }
  return { activity: "idle", problemWhileClosed: false };
}

export type CaptureReturnState = Readonly<{
  selectedSceneId?: string;
  /** Restored via `focus()` when the prior target was a focusable element. */
  focusTarget?: FocusableLike;
}>;

export type FocusableLike = Readonly<{
  focus(): void;
}>;

export function captureReturnStateFromScene(
  selectedSceneId: string | undefined,
  focusTarget: FocusableLike | undefined
): CaptureReturnState {
  return {
    ...(selectedSceneId === undefined ? {} : { selectedSceneId }),
    ...(focusTarget === undefined ? {} : { focusTarget })
  };
}

export function restoreCaptureReturnFocus(
  state: CaptureReturnState | undefined
): void {
  state?.focusTarget?.focus();
}

export function scheduleCaptureFocusRestore(
  state: CaptureReturnState | undefined,
  schedule: (run: () => void) => void
): void {
  if (state === undefined) return;
  schedule(() => restoreCaptureReturnFocus(state));
}

/** Inbox row selection and Capture modal identity are independent shell domains. */
export function inboxSelectionDiffersFromModalCapture(input: Readonly<{
  inboxSelectedCaptureId: string | undefined;
  modalCaptureId: string | undefined;
  modalOpen: boolean;
}>): boolean {
  if (!input.modalOpen || input.modalCaptureId === undefined) return false;
  if (input.inboxSelectedCaptureId === undefined) return true;
  return input.inboxSelectedCaptureId !== input.modalCaptureId;
}
