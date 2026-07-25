import type { ProjectNavigator } from "@ghostwriter/core";
import {
  GhostwriterApiError,
  type CanvasWorkspaceResponse,
  type CaptureHeadResponse,
  type CaptureSummaryResponse,
  type PromoteCaptureCanvasInput,
  type PromoteCaptureManuscriptPlacementInput,
  type PromoteCaptureToSceneResponse
} from "./api.js";
import { sceneDocumentWordCount } from "./draft-desk.js";
import { formatCaptureUpdatedTime } from "./inbox-panel.js";
import {
  listManuscriptHandoffChoices,
  manuscriptHandoffStoryOrderHintText,
  validateManuscriptHandoffSelection,
  type ManuscriptHandoffPlacement
} from "./manuscript-handoff-placement.js";

export const CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE = "Untitled scene" as const;

export const CAPTURE_HANDOFF_PREVIEW_FOOTER =
  "Creates one scene from this exact Capture; nothing changes until Apply." as const;

export const CAPTURE_HANDOFF_PROMOTION_FAILURE_GENERIC =
  "Ghostwriter could not integrate this Capture." as const;

export const CAPTURE_HANDOFF_CAPTURE_CHANGED =
  "This Capture changed elsewhere. Ghostwriter applied nothing." as const;

export const CAPTURE_HANDOFF_NOT_PROMOTABLE =
  "This Capture cannot integrate into Draft right now." as const;

export const CAPTURE_HANDOFF_PROJECT_CHANGED =
  "The project changed elsewhere. Ghostwriter applied nothing." as const;

export const CAPTURE_HANDOFF_CANVAS_CHANGED =
  "The Canvas changed elsewhere. Ghostwriter applied nothing." as const;

export const CAPTURE_HANDOFF_CANVAS_UNAVAILABLE =
  "The Canvas is not available for this project." as const;

export const CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS = {
  minWidth: 120,
  maxWidth: 480,
  minHeight: 80,
  maxHeight: 320,
  defaultX: 120,
  defaultY: 80,
  defaultWidth: 240,
  defaultHeight: 160,
  defaultZ: 1
} as const;

export type CaptureHandoffFormState = Readonly<{
  title: string;
  placementKey: string;
  canvasEnabled: boolean;
}>;

export type CaptureHandoffLayoutMode = "list-only" | "detail-only" | "split";

export type CaptureHandoffPromoteInput = Readonly<{
  captureId: string;
  expectedCaptureWorkingVersion: number;
  expectedCaptureContentHash: string;
  expectedProjectVersion: number;
  title: string;
  manuscriptPlacement: PromoteCaptureManuscriptPlacementInput;
  canvas?: PromoteCaptureCanvasInput;
}>;

export function captureContentHashPrefix(contentHash: string): string {
  return contentHash.slice(0, 8);
}

export function inboxHandoffLayoutMode(
  compact: boolean,
  selectedCaptureId: string | undefined
): CaptureHandoffLayoutMode {
  if (!compact) return "split";
  return selectedCaptureId === undefined ? "list-only" : "detail-only";
}

export function inboxHandoffShowsList(
  compact: boolean,
  selectedCaptureId: string | undefined
): boolean {
  const mode = inboxHandoffLayoutMode(compact, selectedCaptureId);
  return mode === "split" || mode === "list-only";
}

export function inboxHandoffShowsDetailPane(
  compact: boolean,
  selectedCaptureId: string | undefined
): boolean {
  const mode = inboxHandoffLayoutMode(compact, selectedCaptureId);
  return mode === "split" || mode === "detail-only";
}

export function captureHandoffDefaultPlacementKey(
  project: ProjectNavigator
): string {
  return listManuscriptHandoffChoices(project)[0]?.key ?? "";
}

export function captureHandoffDefaultFormState(
  project: ProjectNavigator
): CaptureHandoffFormState {
  return {
    title: CAPTURE_HANDOFF_DEFAULT_SCENE_TITLE,
    placementKey: captureHandoffDefaultPlacementKey(project),
    canvasEnabled: false
  };
}

export type CaptureHandoffPanelSessionState = Readonly<{
  head: CaptureHeadResponse;
  form: CaptureHandoffFormState;
  applying: boolean;
  errorMessage: string | undefined;
}>;

export function captureHandoffPanelShouldResetSession(input: Readonly<{
  captureId: string;
  projectId: string;
  previousCaptureId?: string;
  previousProjectId?: string;
}>): boolean {
  return (
    input.previousCaptureId !== input.captureId ||
    input.previousProjectId !== input.projectId
  );
}

export function captureHandoffPanelSessionForCapture(input: Readonly<{
  project: ProjectNavigator;
  captureHead: CaptureHeadResponse;
}>): CaptureHandoffPanelSessionState {
  return {
    head: input.captureHead,
    form: captureHandoffDefaultFormState(input.project),
    applying: false,
    errorMessage: undefined
  };
}

export function captureHandoffIsEligibleSummary(
  summary: CaptureSummaryResponse
): boolean {
  if (summary.status !== "draft" && summary.status !== "ready") {
    return false;
  }
  return summary.workingVersion > 1;
}

export function captureHandoffIsEligibleHead(
  head: CaptureHeadResponse
): boolean {
  if (head.status !== "draft" && head.status !== "ready") {
    return false;
  }
  if (head.workingVersion <= 1) {
    return false;
  }
  return sceneDocumentWordCount(head.document) > 0;
}

export function captureHandoffPlacementLabel(
  project: ProjectNavigator,
  placementKey: string
): string {
  const match = listManuscriptHandoffChoices(project).find(
    (choice) => choice.key === placementKey
  );
  return match?.label ?? "Unknown placement";
}

export function captureHandoffAuthorityReceiptLines(): readonly string[] {
  return [
    "Deterministic handoff · no AI reads or rewrites this Capture.",
    "You choose the scene title and where it lands in Draft.",
    "Optional Canvas card uses bounded default geometry; manuscript order stays canonical.",
    "Ghostwriter applies nothing until you confirm once."
  ];
}

export function captureHandoffPreviewLines(input: Readonly<{
  captureHead: CaptureHeadResponse;
  projectVersion: number;
  canvasVersion?: number;
  project: ProjectNavigator;
  placementKey: string;
  canvasEnabled: boolean;
}>): readonly string[] {
  const lines = [
    `Capture · acknowledged v${input.captureHead.workingVersion} · hash ${captureContentHashPrefix(input.captureHead.contentHash)}`,
    `Project · v${input.projectVersion}`,
    `Placement · ${captureHandoffPlacementLabel(input.project, input.placementKey)}`
  ];
  if (input.canvasEnabled) {
    lines.push(
      input.canvasVersion === undefined
        ? "Canvas · card requested · version pending"
        : `Canvas · board v${input.canvasVersion} · append card`
    );
  }
  lines.push(CAPTURE_HANDOFF_PREVIEW_FOOTER);
  return lines;
}

export function captureHandoffValidateForm(
  project: ProjectNavigator,
  form: CaptureHandoffFormState
): Readonly<{ valid: true; placement: ManuscriptHandoffPlacement } | { valid: false }> {
  if (form.title.trim().length === 0) {
    return { valid: false };
  }
  return validateManuscriptHandoffSelection(project, form.placementKey);
}

export function captureHandoffCanApply(input: Readonly<{
  head: CaptureHeadResponse | undefined;
  project: ProjectNavigator;
  form: CaptureHandoffFormState;
  busy: boolean;
  canvasEnabledRequiresVersion: boolean;
}>): boolean {
  if (input.busy || input.head === undefined) return false;
  if (!captureHandoffIsEligibleHead(input.head)) return false;
  const validation = captureHandoffValidateForm(input.project, input.form);
  if (!validation.valid) return false;
  if (input.form.canvasEnabled && input.canvasEnabledRequiresVersion) {
    return false;
  }
  return true;
}

export function captureHandoffCanvasStoryOrderHint(
  project: ProjectNavigator,
  placementKey: string
): number | undefined {
  const text = manuscriptHandoffStoryOrderHintText(project, placementKey);
  if (text.length === 0) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function defaultCaptureHandoffCanvasGeometry(input: Readonly<{
  project: ProjectNavigator;
  placementKey: string;
  expectedCanvasVersion: number;
}>): PromoteCaptureCanvasInput | undefined {
  const storyOrderHint = captureHandoffCanvasStoryOrderHint(
    input.project,
    input.placementKey
  );
  if (storyOrderHint === undefined) {
    return undefined;
  }
  const bounds = CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS;
  return {
    expectedCanvasVersion: input.expectedCanvasVersion,
    x: bounds.defaultX,
    y: bounds.defaultY,
    width: bounds.defaultWidth,
    height: bounds.defaultHeight,
    z: bounds.defaultZ,
    storyOrderHint
  };
}

export function captureHandoffCanvasGeometryHintText(
  project: ProjectNavigator,
  placementKey: string
): string {
  const storyOrderHint = captureHandoffCanvasStoryOrderHint(
    project,
    placementKey
  );
  const bounds = CAPTURE_HANDOFF_CANVAS_GEOMETRY_BOUNDS;
  const orderText =
    storyOrderHint === undefined
      ? "story order unavailable"
      : `story order hint ${storyOrderHint}`;
  return `Default card ${bounds.defaultWidth}×${bounds.defaultHeight} at (${bounds.defaultX}, ${bounds.defaultY}) · ${orderText}`;
}

export function buildCaptureHandoffPromoteRequest(input: Readonly<{
  captureId: string;
  captureHead: CaptureHeadResponse;
  projectVersion: number;
  project: ProjectNavigator;
  form: CaptureHandoffFormState;
  canvas?: PromoteCaptureCanvasInput;
}>): CaptureHandoffPromoteInput | undefined {
  const validation = captureHandoffValidateForm(input.project, input.form);
  if (!validation.valid) return undefined;
  if (!captureHandoffIsEligibleHead(input.captureHead)) return undefined;
  if (input.form.canvasEnabled && input.canvas === undefined) return undefined;

  return {
    captureId: input.captureId,
    expectedCaptureWorkingVersion: input.captureHead.workingVersion,
    expectedCaptureContentHash: input.captureHead.contentHash,
    expectedProjectVersion: input.projectVersion,
    title: input.form.title.trim(),
    manuscriptPlacement: validation.placement,
    ...(input.form.canvasEnabled && input.canvas !== undefined
      ? { canvas: input.canvas }
      : {})
  };
}

export function messageForCaptureHandoffPromotionFailure(cause: unknown): string {
  if (cause instanceof GhostwriterApiError && cause.status === 401) {
    return "Your session ended. Sign in again before integrating this Capture.";
  }
  if (cause instanceof GhostwriterApiError) {
    switch (cause.code) {
      case "CAPTURE_VERSION_CONFLICT":
      case "CAPTURE_CONTENT_CHANGED":
        return CAPTURE_HANDOFF_CAPTURE_CHANGED;
      case "CAPTURE_NOT_PROMOTABLE":
        return CAPTURE_HANDOFF_NOT_PROMOTABLE;
      case "VERSION_CONFLICT":
        return CAPTURE_HANDOFF_PROJECT_CHANGED;
      case "CANVAS_VERSION_CONFLICT":
        return CAPTURE_HANDOFF_CANVAS_CHANGED;
      case "CANVAS_NOT_FOUND":
        return CAPTURE_HANDOFF_CANVAS_UNAVAILABLE;
      default:
        break;
    }
  }
  return CAPTURE_HANDOFF_PROMOTION_FAILURE_GENERIC;
}

export function captureHandoffIntegratedSceneId(
  head: CaptureHeadResponse
): string | undefined {
  return head.integratedSceneId;
}

export function captureHandoffIntegratedReceiptLines(
  head: CaptureHeadResponse
): readonly string[] {
  const lines: string[] = ["Integrated into Draft · source Capture retained."];
  if (head.integrationRevisionId !== undefined) {
    lines.push(`Integration revision · ${head.integrationRevisionId}`);
  }
  if (head.integratedSceneId !== undefined) {
    lines.push(`Target scene · ${head.integratedSceneId}`);
  }
  if (head.integratedAt !== undefined) {
    lines.push(`Integrated · ${formatCaptureUpdatedTime(head.integratedAt)}`);
  }
  lines.push(
    `Capture snapshot · v${head.workingVersion} · hash ${captureContentHashPrefix(head.contentHash)}`
  );
  return lines;
}

export function captureHandoffOpenDraftAvailable(
  head: CaptureHeadResponse
): boolean {
  return head.status === "integrated" && head.integratedSceneId !== undefined;
}

export function captureHandoffOpenSplitAvailable(
  head: CaptureHeadResponse
): boolean {
  return captureHandoffOpenDraftAvailable(head);
}

export function captureHandoffSuccessHead(
  response: PromoteCaptureToSceneResponse
): CaptureHeadResponse {
  return response.captureHead;
}

export type CapturePromotionStateInstall = Readonly<{
  navigator: ProjectNavigator;
  canvasWorkspace?: CanvasWorkspaceResponse;
}>;

export function installCapturePromotionState(
  response: PromoteCaptureToSceneResponse
): CapturePromotionStateInstall {
  return {
    navigator: response.navigator,
    ...(response.canvas === undefined ? {} : { canvasWorkspace: response.canvas })
  };
}

export function acknowledgementCopyForCapturePromotion(
  response: PromoteCaptureToSceneResponse
): Readonly<{ title: string; detail: string }> {
  return {
    title: "Capture integrated",
    detail: `${response.scene.title} · Saved to project`
  };
}

export function handoffReceiptOpenMode(
  target: "draft" | "split",
  compact: boolean
): "draft" | "split" | undefined {
  if (target === "split" && compact) return undefined;
  return target;
}

/** When draft preparation fails, shell must not close Inbox or retarget selection. */
export function handoffTargetShouldAbortAfterDraftPrepFailed(
  draftPrepFailed: boolean
): boolean {
  return draftPrepFailed;
}

export function captureHandoffApplyStatusText(input: Readonly<{
  applying: boolean;
  errorMessage?: string;
  integrated: boolean;
}>): string {
  if (input.applying) return "Applying integration…";
  if (input.errorMessage !== undefined) return input.errorMessage;
  if (input.integrated) {
    return "Integration saved · source Capture is read-only.";
  }
  return "Ready to apply once.";
}
