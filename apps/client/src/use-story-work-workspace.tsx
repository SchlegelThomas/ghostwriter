import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  canonicalJsonStringify,
  validateCharacterCreateV2,
  validateSceneDraftV1,
  validateStoryCheckFindingsV1,
  validateStoryStructureProposalV1,
  type AgentModelId,
  type BookId,
  type ProjectNavigator,
  type SceneId,
  type StoryKnowledgeId,
  type StoryStructureOperationId,
  type StoryWorkAssignment,
  type StoryWorkAssignmentId,
  type StoryWorkCoordinationId,
  type StoryWorkCoordinationStepProjection,
  type StoryWorkTaskKind
} from "@ghostwriter/core";
import {
  CharacterStoryWorkReview,
  SceneStoryWorkReview,
  STORY_WORK_HEADING_NATIVE_ID,
  StoryCheckReview,
  StoryStructureReview,
  StoryWorkCoordinationReview,
  StoryWorkPanel,
  buildStoryWorkCoordinationReviewStepView,
  storyWorkCoordinationReviewActionLabel,
  ghostwriterTheme,
  storyWorkAssignmentButtonNativeId,
  storyWorkCoordinationButtonNativeId,
  type SceneReviewApplyRequest,
  type SceneReviewDestination,
  type SceneStoryWorkRevisionPrefill,
  type StoryStructureReviewPreviewBinding,
  type StoryWorkOutlineBookOption,
  type StoryWorkPanelRevisePrefill,
  type StoryWorkCoordinationCardSummary,
  type StoryWorkCoordinationReviewStepActionKind,
  type StoryWorkCoordinationReviewStepViewModel,
  type SubmitStoryWorkBrief,
  type WorkspaceAvailableModel
} from "@ghostwriter/ui";
import { storyWorkRetryInput } from "./story-work-attempt-input.js";
import { storyWorkScenePlacementChoices } from "./story-work-scene-placement.js";
import {
  inferSceneStoryWorkAppliedMode,
  refuseCreateSceneCanvasWhenRequested,
  resolveSceneStoryWorkAppliedMode,
  resolveSceneStoryWorkApplyIdempotencyKey,
  runSceneStoryWorkUpdateApply,
  sceneStoryWorkApplySemanticFingerprint,
  type SceneStoryWorkDraftBoundary
} from "./story-work-scene-apply-boundary.js";
import {
  applyCharacterStoryWork,
  applySceneStoryWork,
  applyStructureStoryWork,
  GhostwriterApiError,
  recoverActiveStoryWorkAttempt,
  completeStoryCheckReview,
  continueStoryWorkCoordinationStep,
  createCharacterStoryWorkAssignment,
  createCheckStoryWorkAssignment,
  createOutlineStoryWorkAssignment,
  createSceneStoryWorkAssignment,
  createStoryWorkCoordination,
  getProject,
  getStoryWorkAssignment,
  getStoryWorkCoordination,
  listStoryWorkAssignments,
  listStoryWorkCoordinations,
  openStoryCheckReview,
  previewStoryStructureStoryWork,
  resolveStoryCheckFinding,
  reviewCharacterStoryWork,
  reviewSceneStoryWork,
  reviewStoryStructureStoryWork,
  startCharacterStoryWorkAttempt,
  startSceneStoryWorkAttempt,
  startStoryCheckAttempt,
  startStoryStructureAttempt,
  type ApplySceneStoryWorkCanvasPlacement,
  type ApplyStructureStoryWorkCanvasPlacement,
  type StoryWorkCoordinationDetailResponse,
  type StoryWorkDetailResponse,
  type StoryWorkRecoveryAction
} from "./api.js";
import {
  buildStoryWorkCoordinationCheckAttemptInput,
  buildStoryWorkCoordinationCreateInput,
  buildStoryWorkCoordinationRootAttemptInput,
  deriveStoryWorkCoordinationReloadAutoAction,
  deriveStoryWorkCoordinationStepAction,
  presentStoryWorkCoordinationCard,
  releaseStoryWorkCoordinationContinue,
  reloadStoryWorkCoordinationWorkspaceDetail,
  storyWorkCoordinationContinueSemanticFingerprint,
  storyWorkCoordinationTransitionConflictRequiresDetailRefresh,
  tryAcquireStoryWorkCoordinationContinue,
  StoryWorkCoordinationCreateInputError,
  type StoryWorkCoordinationStepAction,
  type StoryWorkCoordinationWorkspaceState
} from "./story-work-coordination-workspace.js";
import {
  messageForStoryWorkRecoveryFailure,
  presentStoryWorkReloadRecovery,
  storyWorkNonReviewableStatusLine,
  storyWorkRecoverySuccessMessage,
  storyWorkReloadRecoveryShowsRetry
} from "./story-work-recovery-presentation.js";
import {
  buildCheckStoryWorkCreateInput,
  buildProposalCheckTargets,
  chooseStoryCheckRevisionFollowUp,
  deriveStoryCheckRevisionPrefill,
  isCheckStoryWorkAssignment,
  sceneStoryWorkRevisionPrefillScopeKey,
  STORY_CHECK_REVISION_DONE_WHEN,
  storyWorkScopeEpochMismatch,
  validateProposalDraftRevisionFollowUp
} from "./story-check-workspace.js";
import {
  buildOutlineStoryWorkCreateInput,
  deriveOutlineStoryWorkActiveBooks,
  deriveOutlineStoryWorkDefaultTargetBookId,
  storyStructurePreviewCacheFingerprint
} from "./story-structure-workspace.js";
import type { SceneStoryWorkApplyResult } from "@ghostwriter/core";

function isCharacterStoryWorkAssignment(assignment: StoryWorkAssignment): boolean {
  return assignment.taskKind === "character";
}

function isSceneStoryWorkAssignment(assignment: StoryWorkAssignment): boolean {
  return assignment.taskKind === "scene" || assignment.taskKind === "revise";
}

function isOutlineStoryWorkAssignment(assignment: StoryWorkAssignment): boolean {
  return assignment.taskKind === "outline";
}

function storyWorkTaskLabel(taskKind: StoryWorkTaskKind): string {
  switch (taskKind) {
    case "character":
      return "Character";
    case "scene":
      return "Scene";
    case "revise":
      return "Scene revision";
    case "outline":
      return "Outline";
    case "check":
      return "Check story";
    default:
      return "Story work";
  }
}

function bookTitleInProject(project: ProjectNavigator, bookId: BookId): string | undefined {
  for (const book of project.books) {
    if (book.archivedAt !== undefined) continue;
    if (book.id === bookId) return book.title;
  }
  return undefined;
}

function structurePreviewScopeKey(input: Readonly<{
  projectId: string;
  assignmentId: StoryWorkAssignmentId;
  proposalId: string;
  artifactVersion: number;
  contentHash: string;
}>): string {
  return `${input.projectId}:${input.assignmentId}:${input.proposalId}:${input.artifactVersion}:${input.contentHash}`;
}

function sortedStructureOperationIds(
  ids: readonly StoryStructureOperationId[]
): readonly StoryStructureOperationId[] {
  return Object.freeze([...ids].sort((left, right) => String(left).localeCompare(String(right))));
}

function structureApplySemanticFingerprint(input: Readonly<Record<string, unknown>>): string {
  return canonicalJsonStringify(input);
}

type StoryStructureWorkResult = Extract<
  StoryWorkAssignment["results"][number],
  { kind: "story-structure" }
>;

function storyStructureWorkResult(
  assignment: StoryWorkAssignment
): StoryStructureWorkResult | undefined {
  if (assignment.status !== "applied") return undefined;
  const matches = assignment.results.filter(
    (entry): entry is StoryStructureWorkResult => entry.kind === "story-structure"
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function structureResultHasCanvasPlacement(result: StoryStructureWorkResult): boolean {
  return result.canvasPlacedSceneId !== undefined || result.canvasObjectId !== undefined;
}

function inferStructureAppliedProjectVersion(assignment: StoryWorkAssignment): number | undefined {
  const structure = storyStructureWorkResult(assignment);
  if (structure !== undefined) return structure.projectVersion;
  const bookResult = assignment.results.find(
    (entry): entry is Extract<(typeof assignment.results)[number], { kind: "book" }> =>
      entry.kind === "book"
  );
  return bookResult?.projectVersion;
}

function inferStructureAppliedPresentation(
  assignment: StoryWorkAssignment,
  project: ProjectNavigator | undefined
): Readonly<{
  appliedProjectVersion: number;
  firstCreatedSceneId?: SceneId;
  canvasPlacedSceneLabel?: string;
}> | undefined {
  const result = storyStructureWorkResult(assignment);
  if (result === undefined) return undefined;
  const canvasPlacedSceneId = result.canvasPlacedSceneId;
  return Object.freeze({
    appliedProjectVersion: result.projectVersion,
    firstCreatedSceneId: result.createdSceneIds[0],
    ...(canvasPlacedSceneId === undefined
      ? {}
      : {
          canvasPlacedSceneLabel:
            project === undefined
              ? "Canvas card"
              : sceneTitleInProject(project, canvasPlacedSceneId) ?? "Canvas card"
        })
  });
}

function sceneTitleInProject(project: ProjectNavigator, sceneId: SceneId): string | undefined {
  for (const book of project.books) {
    if (book.archivedAt !== undefined) continue;
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          if (scene.id === sceneId && scene.archivedAt === undefined) return scene.title;
        }
      }
    }
    for (const scene of book.unassignedScenes) {
      if (scene.id === sceneId && scene.archivedAt === undefined) return scene.title;
    }
  }
  return undefined;
}

function suggestedSceneTitleFromBrief(brief: string): string | undefined {
  const line = brief.split("\n").map((entry) => entry.trim()).find((entry) => entry.length > 0);
  if (line === undefined) return undefined;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

const COORDINATION_STRUCTURAL_TITLE = "Scene + continuity check";
const COORDINATION_SCENE_STEP_TITLE = "Draft scene";
const COORDINATION_CHECK_STEP_TITLE = "Check proposal";

function coordinationChildAssignmentMap(
  detail: StoryWorkCoordinationDetailResponse,
  extra?: ReadonlyMap<StoryWorkAssignmentId, StoryWorkAssignment>
): ReadonlyMap<StoryWorkAssignmentId, StoryWorkAssignment> {
  const map = new Map<StoryWorkAssignmentId, StoryWorkAssignment>();
  map.set(detail.rootAssignment.id, detail.rootAssignment);
  if (extra !== undefined) {
    for (const [id, assignment] of extra) map.set(id, assignment);
  }
  return map;
}

function coordinationStepCheckBound(
  detail: StoryWorkCoordinationDetailResponse,
  stepProjection: StoryWorkCoordinationStepProjection
): boolean {
  if (stepProjection.kind !== "proposal-continuity-check") return false;
  const definition = detail.coordination.steps.find((entry) => entry.stepId === stepProjection.stepId);
  if (
    definition?.kind === "proposal-continuity-check" &&
    definition.binding !== undefined
  ) {
    return true;
  }
  return detail.childAssignmentSummaries.some((entry) => entry.stepId === stepProjection.stepId);
}

function coordinationStepAssignmentStatus(
  detail: StoryWorkCoordinationDetailResponse,
  stepProjection: StoryWorkCoordinationStepProjection,
  childMap: ReadonlyMap<StoryWorkAssignmentId, StoryWorkAssignment>
): StoryWorkAssignment["status"] | undefined {
  if (stepProjection.kind === "scene-draft") return detail.rootAssignment.status;
  if (stepProjection.state === "blocked") return undefined;
  if (
    stepProjection.state === "ready" &&
    stepProjection.kind === "proposal-continuity-check" &&
    stepProjection.resolvedDependency !== undefined
  ) {
    return undefined;
  }
  const assignmentId = stepProjection.assignmentId;
  if (assignmentId === undefined) {
    return detail.childAssignmentSummaries.find((entry) => entry.stepId === stepProjection.stepId)
      ?.status;
  }
  return (
    childMap.get(assignmentId)?.status ??
    detail.childAssignmentSummaries.find((entry) => entry.stepId === stepProjection.stepId)?.status
  );
}

function clientCoordinationActionKind(
  action: StoryWorkCoordinationStepAction
): StoryWorkCoordinationReviewStepActionKind | undefined {
  if (action.kind === "none") return undefined;
  return action.kind;
}

function buildCoordinationReviewSteps(
  detail: StoryWorkCoordinationDetailResponse,
  extraAssignments?: ReadonlyMap<StoryWorkAssignmentId, StoryWorkAssignment>
): readonly StoryWorkCoordinationReviewStepViewModel[] {
  const childMap = coordinationChildAssignmentMap(detail, extraAssignments);
  return Object.freeze(
    detail.projection.steps.map((stepProjection) => {
      const clientAction = deriveStoryWorkCoordinationStepAction({
        detail,
        stepProjection,
        childAssignmentsById: childMap
      });
      const assignmentStatus = coordinationStepAssignmentStatus(
        detail,
        stepProjection,
        childMap
      );
      const continueCheckReady =
        stepProjection.state === "ready" &&
        stepProjection.kind === "proposal-continuity-check" &&
        stepProjection.resolvedDependency !== undefined;
      const view = buildStoryWorkCoordinationReviewStepView(
        Object.freeze({
          stepId: stepProjection.stepId,
          title: stepProjection.title,
          kind: stepProjection.kind,
          state: stepProjection.state,
          ...(stepProjection.state === "blocked"
            ? { blockedReasons: stepProjection.reasons }
            : {}),
          ...(assignmentStatus === undefined ? {} : { assignmentStatus }),
          ...(continueCheckReady ? { continueCheckReady: true } : {}),
          ...(coordinationStepCheckBound(detail, stepProjection)
            ? { checkBound: true }
            : {})
        })
      );
      const expectedKind = clientCoordinationActionKind(clientAction);
      if (expectedKind !== undefined && view.action?.kind !== expectedKind) {
        return Object.freeze({
          ...view,
          action: Object.freeze({
            kind: expectedKind,
            label: storyWorkCoordinationReviewActionLabel(expectedKind)
          })
        });
      }
      if (expectedKind === undefined) {
        return Object.freeze({ ...view, action: undefined });
      }
      return view;
    })
  );
}

function sceneReviewDestination(
  project: ProjectNavigator,
  assignment: StoryWorkAssignment,
  currentCanvas?: Readonly<{ label: string; description?: string }>
): SceneReviewDestination {
  if (assignment.destination.kind !== "scene") {
    throw new Error("This scene assignment does not have a scene destination.");
  }
  if (assignment.destination.operation === "create") {
    return Object.freeze({
      operation: "create",
      label: "Create scene from review",
      suggestedTitle: suggestedSceneTitleFromBrief(assignment.brief),
      placementChoices: storyWorkScenePlacementChoices(project.books),
      currentCanvas
    });
  }
  const title = sceneTitleInProject(project, assignment.destination.sceneId) ?? "Selected scene";
  return Object.freeze({
    operation: "update",
    label: title
  });
}

export function useStoryWorkWorkspace(input: Readonly<{
  project?: ProjectNavigator;
  accountId?: string;
  selectedSceneId?: SceneId;
  model?: AgentModelId;
  models: readonly WorkspaceAvailableModel[];
  onProjectChanged(project: ProjectNavigator): void;
  onOpenSettings(): void;
  sceneCanvasDescriptor?: Readonly<{ label: string; description?: string }>;
  storyWorkSceneApply?: Readonly<{
    prepareUpdateTarget(sceneId: SceneId): Promise<SceneStoryWorkDraftBoundary>;
    finishUpdate(): Promise<void>;
    prepareCreateCanvasPlacement(): Promise<ApplySceneStoryWorkCanvasPlacement>;
    refreshCanvas(): Promise<void>;
    openScene(sceneId: SceneId): void;
  }>;
  storyWorkNavigation?: Readonly<{
    openScene(input: Readonly<{ sceneId: SceneId; blockId?: string }>): void;
    openStoryIntent?(input: Readonly<{
      sceneId?: SceneId;
      storyKnowledgeId?: StoryKnowledgeId;
    }>): void;
  }>;
}>) {
  const projectId = input.project?.id;
  const scopeKey = `${input.accountId ?? ""}:${projectId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  const scopeEpoch = useRef(0);
  if (scopeRef.current !== scopeKey) { scopeRef.current = scopeKey; scopeEpoch.current += 1; }
  const renderEpoch = scopeEpoch.current;
  const [panelOpen, setPanelOpen] = useState(false);
  const [assignments, setAssignments] = useState<readonly StoryWorkAssignment[]>([]);
  const [detail, setDetail] = useState<StoryWorkDetailResponse>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [projectRefreshError, setProjectRefreshError] = useState<{ assignmentId: string; message: string }>();
  const [requestedKnowledgeId, setRequestedKnowledgeId] = useState<StoryKnowledgeId>();
  const [sceneAppliedMode, setSceneAppliedMode] = useState<SceneReviewApplyRequest["mode"]>();
  const [revisePrefill, setRevisePrefill] = useState<StoryWorkPanelRevisePrefill>();
  const [sceneReviewRevisionPrefill, setSceneReviewRevisionPrefill] = useState<
    Readonly<{ scopeKey: string; prefill: SceneStoryWorkRevisionPrefill }> | undefined
  >();
  const openSequence = useRef(0);
  const submitRequest = useRef<{ fingerprint: string; key: string; attemptKey: string; assignment?: StoryWorkAssignment } | undefined>(undefined);
  const revisionRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const retryRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const applyCharacterRequest = useRef<Parameters<typeof applyCharacterStoryWork>[0] | undefined>(undefined);
  const applySceneRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const applyStructureRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const returnFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [operationPending, setOperationPending] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string>();
  const [structurePreviewCache, setStructurePreviewCache] = useState<
    Readonly<{ scopeKey: string; binding: StoryStructureReviewPreviewBinding }> | undefined
  >(undefined);
  const [coordinations, setCoordinations] = useState<
    readonly StoryWorkCoordinationDetailResponse[]
  >([]);
  const [coordinationsLoading, setCoordinationsLoading] = useState(false);
  const [coordinationsError, setCoordinationsError] = useState<string>();
  const [coordinationDetail, setCoordinationDetail] = useState<
    StoryWorkCoordinationDetailResponse | undefined
  >(undefined);
  const [coordinationReviewOpen, setCoordinationReviewOpen] = useState(false);
  const [coordinationMessage, setCoordinationMessage] = useState<string>();
  const [coordinationError, setCoordinationError] = useState<string>();
  const [coordinationChildAssignments, setCoordinationChildAssignments] = useState<
    ReadonlyMap<StoryWorkAssignmentId, StoryWorkAssignment>
  >(new Map());
  const coordinationCreateRequest = useRef<
    { fingerprint: string; key: string; coordinationId?: StoryWorkCoordinationId } | undefined
  >(undefined);
  const coordinationAttemptKeys = useRef<
    Map<string, Readonly<{ fingerprint: string; key: string }>>
  >(new Map());
  const coordinationWorkspaceRef = useRef<StoryWorkCoordinationWorkspaceState>({});
  const pendingCoordinationFocusRef = useRef<StoryWorkCoordinationId | undefined>(undefined);

  function clearStructurePreviewBinding() {
    setStructurePreviewCache(undefined);
  }

  const onReviewDirty = useCallback((dirty: boolean) => { if (scopeEpoch.current === renderEpoch) setReviewDirty(dirty); }, [renderEpoch]);
  const onReviewBusy = useCallback((pending: boolean) => { if (scopeEpoch.current === renderEpoch) setOperationPending(pending); }, [renderEpoch]);
  function cancelReturnFocus() {
    if (returnFocusTimer.current === undefined) return;
    clearTimeout(returnFocusTimer.current);
    returnFocusTimer.current = undefined;
  }

  function focusVisibleStoryWorkTarget(id: string): boolean {
    if (typeof document === "undefined") return false;
    const target = document.getElementById(id);
    if (!(target instanceof HTMLElement) || target.getClientRects().length === 0) return false;
    if (target.tabIndex < 0) target.tabIndex = -1;
    target.focus();
    return true;
  }

  function closeReview(restoreFocus = false) {
    if (reviewDirty || operationPending) return;
    openSequence.current += 1;
    cancelReturnFocus();
    const assignmentId = detail?.assignment.id;
    const coordinationFocusId = pendingCoordinationFocusRef.current;
    pendingCoordinationFocusRef.current = undefined;
    const epoch = scopeEpoch.current;
    setReviewOpen(false);
    if (coordinationFocusId !== undefined) {
      void loadCoordinationDetail(coordinationFocusId, {
        openReview: false,
        clearAttemptKeys: true,
        manageBusy: false
      });
    }
    if (!restoreFocus) return;
    returnFocusTimer.current = setTimeout(() => {
      returnFocusTimer.current = undefined;
      if (scopeEpoch.current !== epoch) return;
      if (
        coordinationFocusId !== undefined &&
        focusVisibleStoryWorkTarget(
          storyWorkCoordinationButtonNativeId(coordinationFocusId)
        )
      ) {
        return;
      }
      if (
        assignmentId !== undefined &&
        focusVisibleStoryWorkTarget(storyWorkAssignmentButtonNativeId(assignmentId))
      ) return;
      focusVisibleStoryWorkTarget(STORY_WORK_HEADING_NATIVE_ID);
    }, 30);
  }

  function closeCoordinationReview(restoreFocus = false) {
    if (operationPending) return;
    cancelReturnFocus();
    const coordinationId = coordinationDetail?.coordination.id;
    const epoch = scopeEpoch.current;
    setCoordinationReviewOpen(false);
    if (!restoreFocus || coordinationId === undefined) return;
    returnFocusTimer.current = setTimeout(() => {
      returnFocusTimer.current = undefined;
      if (scopeEpoch.current !== epoch) return;
      focusVisibleStoryWorkTarget(storyWorkCoordinationButtonNativeId(coordinationId));
    }, 30);
  }

  function resetCoordinationAttemptKeys() {
    coordinationAttemptKeys.current = new Map();
  }

  function coordinationAttemptKey(
    assignmentId: StoryWorkAssignmentId,
    fingerprint: string
  ): string {
    const current = coordinationAttemptKeys.current.get(assignmentId);
    if (current?.fingerprint !== fingerprint) {
      coordinationAttemptKeys.current.set(
        assignmentId,
        Object.freeze({ fingerprint, key: crypto.randomUUID() })
      );
    }
    return coordinationAttemptKeys.current.get(assignmentId)!.key;
  }

  function clearCoordinationAttemptKey(assignmentId: StoryWorkAssignmentId) {
    coordinationAttemptKeys.current.delete(assignmentId);
  }

  useEffect(() => {
    cancelReturnFocus();
    setProjectRefreshError(undefined); retryRequest.current = undefined;
    setPanelOpen(false); setAssignments([]); setDetail(undefined); setReviewOpen(false); setReviewDirty(false); setError(undefined);
    setRecoveryNotice(undefined);
    setRequestedKnowledgeId(undefined); submitRequest.current = undefined; revisionRequest.current = undefined;
    applyCharacterRequest.current = undefined; applySceneRequest.current = undefined;
    applyStructureRequest.current = undefined;
    setSceneAppliedMode(undefined);
    setRevisePrefill(undefined);
    setSceneReviewRevisionPrefill(undefined);
    clearStructurePreviewBinding();
    setCoordinations([]);
    setCoordinationsLoading(false);
    setCoordinationsError(undefined);
    setCoordinationDetail(undefined);
    setCoordinationReviewOpen(false);
    setCoordinationMessage(undefined);
    setCoordinationError(undefined);
    setCoordinationChildAssignments(new Map());
    coordinationCreateRequest.current = undefined;
    coordinationWorkspaceRef.current = {};
    resetCoordinationAttemptKeys();
    pendingCoordinationFocusRef.current = undefined;
    openSequence.current += 1; setOperationPending(false);
    return cancelReturnFocus;
  }, [scopeKey]);

  const upsert = useCallback((assignment: StoryWorkAssignment) => {
    setAssignments((current) => [assignment, ...current.filter((entry) => entry.id !== assignment.id)]);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const scope = scopeEpoch.current;
    setLoading(true);
    setCoordinationsLoading(true);
    try {
      const [nextAssignments, nextCoordinations] = await Promise.all([
        listStoryWorkAssignments(projectId),
        listStoryWorkCoordinations(projectId)
      ]);
      if (scope === scopeEpoch.current) {
        setAssignments(nextAssignments);
        setCoordinations(nextCoordinations.coordinations);
        setError(undefined);
        setCoordinationsError(undefined);
        resetCoordinationAttemptKeys();
      }
    } catch (cause) {
      if (scope === scopeEpoch.current) {
        const message =
          cause instanceof Error ? cause.message : "Story work could not be loaded.";
        setError(message);
        setCoordinationsError(message);
      }
    } finally {
      if (scope === scopeEpoch.current) {
        setLoading(false);
        setCoordinationsLoading(false);
      }
    }
  }, [projectId]);

  function applyCoordinationDetailState(
    next: StoryWorkCoordinationDetailResponse,
    options?: Readonly<{ openReview?: boolean; clearAttemptKeys?: boolean }>
  ) {
    const reloadAction = deriveStoryWorkCoordinationReloadAutoAction(
      coordinationWorkspaceRef.current,
      next
    );
    if (reloadAction.kind !== "none") {
      throw new Error("Reloaded coordinated story work cannot start an action automatically.");
    }
    coordinationWorkspaceRef.current = reloadStoryWorkCoordinationWorkspaceDetail(
      coordinationWorkspaceRef.current,
      next
    );
    if (options?.clearAttemptKeys !== false) resetCoordinationAttemptKeys();
    setCoordinationDetail(next);
    setCoordinationChildAssignments(new Map());
    upsert(next.rootAssignment);
    setCoordinations((current) => {
      const without = current.filter(
        (entry) => entry.coordination.id !== next.coordination.id
      );
      return Object.freeze([next, ...without]);
    });
    if (options?.openReview) {
      openSequence.current += 1;
      setReviewOpen(false);
      setCoordinationReviewOpen(true);
    }
  }

  function handleCoordinationUnavailable(coordinationId: StoryWorkCoordinationId) {
    setCoordinationReviewOpen(false);
    setCoordinationDetail(undefined);
    setCoordinations((current) =>
      current.filter((entry) => entry.coordination.id !== coordinationId)
    );
    setCoordinationError(
      "This coordinated story work is unavailable. Refresh story work and try again."
    );
  }

  async function fetchAndApplyCoordinationDetail(
    coordinationId: StoryWorkCoordinationId,
    options?: Readonly<{ openReview?: boolean; clearAttemptKeys?: boolean }>
  ) {
    if (!projectId) return;
    const scope = scopeEpoch.current;
    const next = await getStoryWorkCoordination(projectId, coordinationId);
    if (scope !== scopeEpoch.current) return;
    applyCoordinationDetailState(next, options);
  }

  async function loadCoordinationDetail(
    coordinationId: StoryWorkCoordinationId,
    options?: Readonly<{
      openReview?: boolean;
      clearAttemptKeys?: boolean;
      manageBusy?: boolean;
    }>
  ) {
    if (!projectId || (options?.manageBusy !== false && operationPending)) return;
    const scope = scopeEpoch.current;
    if (options?.manageBusy !== false) setOperationPending(true);
    setCoordinationError(undefined);
    try {
      await fetchAndApplyCoordinationDetail(coordinationId, options);
    } catch (cause) {
      if (scope !== scopeEpoch.current) return;
      if (cause instanceof GhostwriterApiError && cause.status === 404) {
        handleCoordinationUnavailable(coordinationId);
        return;
      }
      setCoordinationError(
        cause instanceof Error
          ? cause.message
          : "Coordinated story work could not be loaded."
      );
    } finally {
      if (options?.manageBusy !== false && scope === scopeEpoch.current) {
        setOperationPending(false);
      }
    }
  }

  async function openCoordination(coordinationId: StoryWorkCoordinationId) {
    if (reviewDirty || operationPending) return;
    setCoordinationMessage(undefined);
    await loadCoordinationDetail(coordinationId, { openReview: true });
  }

  async function refreshCoordinationDetailOnly() {
    const coordinationId = coordinationDetail?.coordination.id;
    if (!projectId || coordinationId === undefined || operationPending) return;
    const scope = scopeEpoch.current;
    setOperationPending(true);
    setCoordinationError(undefined);
    try {
      await fetchAndApplyCoordinationDetail(coordinationId, { clearAttemptKeys: true });
      if (scope === scopeEpoch.current) {
        setCoordinationMessage("Coordination details refreshed.");
      }
    } catch (cause) {
      if (scope !== scopeEpoch.current) return;
      if (cause instanceof GhostwriterApiError && cause.status === 404) {
        handleCoordinationUnavailable(coordinationId);
        return;
      }
      throw cause;
    } finally {
      if (scope === scopeEpoch.current) setOperationPending(false);
    }
  }

  async function runCoordinationStepAction(
    stepId: string,
    kind: StoryWorkCoordinationReviewStepActionKind
  ) {
    if (!projectId || !coordinationDetail || operationPending) return;
    const scope = scopeEpoch.current;
    const stepProjection = coordinationDetail.projection.steps.find(
      (entry) => entry.stepId === stepId
    );
    if (stepProjection === undefined) {
      setCoordinationError("Refresh coordination details before trying again.");
      return;
    }
    const childMap = coordinationChildAssignmentMap(
      coordinationDetail,
      coordinationChildAssignments
    );
    const clientAction = deriveStoryWorkCoordinationStepAction({
      detail: coordinationDetail,
      stepProjection,
      childAssignmentsById: childMap
    });
    const clientKind = clientCoordinationActionKind(clientAction);
    if (clientKind !== kind) {
      setCoordinationError("Refresh coordination details before trying again.");
      return;
    }

    if (
      kind === "open-root-review" ||
      kind === "open-check-review" ||
      kind === "recover-child" ||
      kind === "retry-child"
    ) {
      if (
        clientAction.kind !== "open-root-review" &&
        clientAction.kind !== "open-check-review" &&
        clientAction.kind !== "recover-child" &&
        clientAction.kind !== "retry-child"
      ) {
        return;
      }
      const assignmentId = clientAction.assignmentId;
      pendingCoordinationFocusRef.current = coordinationDetail.coordination.id;
      setCoordinationReviewOpen(false);
      setCoordinationMessage(undefined);
      setCoordinationError(undefined);
      await openAssignment(assignmentId, { fromCoordination: true });
      return;
    }

    setOperationPending(true);
    setCoordinationMessage(undefined);
    setCoordinationError(undefined);
    try {
      if (kind === "start-root") {
        if (clientAction.kind !== "start-root") return;
        const fingerprint = JSON.stringify({
          coordinationId: coordinationDetail.coordination.id,
          assignmentId: clientAction.assignmentId,
          version: coordinationDetail.rootAssignment.version
        });
        const attemptKey = coordinationAttemptKey(clientAction.assignmentId, fingerprint);
        const started = await startSceneStoryWorkAttempt(
          buildStoryWorkCoordinationRootAttemptInput({
            projectId,
            rootAssignment: coordinationDetail.rootAssignment,
            callerIdempotencyKey: attemptKey
          })
        );
        if (scope !== scopeEpoch.current) return;
        upsert(started.state.assignment);
        clearCoordinationAttemptKey(clientAction.assignmentId);
        await fetchAndApplyCoordinationDetail(coordinationDetail.coordination.id, {
          openReview: true,
          clearAttemptKeys: false
        });
        return;
      }

      if (kind === "continue-check") {
        if (clientAction.kind !== "continue-check") return;
        const fingerprint = storyWorkCoordinationContinueSemanticFingerprint({
          coordinationId: coordinationDetail.coordination.id,
          stepId: clientAction.stepId,
          expectedCoordinationVersion: clientAction.request.expectedCoordinationVersion,
          expectedUpstreamArtifact: clientAction.request.expectedUpstreamArtifact
        });
        const acquired = tryAcquireStoryWorkCoordinationContinue(
          coordinationWorkspaceRef.current,
          fingerprint
        );
        if (!acquired.accepted) return;
        coordinationWorkspaceRef.current = acquired.next;
        try {
          const continued = await continueStoryWorkCoordinationStep({
            projectId,
            coordinationId: coordinationDetail.coordination.id,
            stepId: clientAction.stepId,
            ...clientAction.request
          });
          if (scope !== scopeEpoch.current) return;
          coordinationWorkspaceRef.current = releaseStoryWorkCoordinationContinue(
            coordinationWorkspaceRef.current,
            fingerprint
          );
          upsert(continued.rootAssignment);
          upsert(continued.checkAssignment);
          setCoordinationChildAssignments((current) => {
            const map = new Map(current);
            map.set(continued.checkAssignment.id, continued.checkAssignment);
            return map;
          });
          await fetchAndApplyCoordinationDetail(coordinationDetail.coordination.id, {
            openReview: true,
            clearAttemptKeys: false
          });
          if (scope !== scopeEpoch.current) return;
          setCoordinationMessage(
            continued.replayed
              ? "Continuity check was already bound to the upstream proposal."
              : "Continuity check bound to the upstream proposal. Start it when you are ready."
          );
        } catch (cause) {
          coordinationWorkspaceRef.current = releaseStoryWorkCoordinationContinue(
            coordinationWorkspaceRef.current,
            fingerprint
          );
          if (scope !== scopeEpoch.current) return;
          if (storyWorkCoordinationTransitionConflictRequiresDetailRefresh(cause)) {
            await fetchAndApplyCoordinationDetail(coordinationDetail.coordination.id, {
              openReview: true,
              clearAttemptKeys: false
            });
            if (scope === scopeEpoch.current) {
              setCoordinationError(
                `${cause.message} Refresh coordination and try again.`
              );
            }
            return;
          }
          throw cause;
        }
        return;
      }

      if (kind === "start-check") {
        if (clientAction.kind !== "start-check") return;
        let checkAssignment = coordinationChildAssignments.get(clientAction.assignmentId);
        if (checkAssignment === undefined) {
          const loaded = await getStoryWorkAssignment(projectId, clientAction.assignmentId);
          if (scope !== scopeEpoch.current) return;
          checkAssignment = loaded.assignment;
          setCoordinationChildAssignments((current) => {
            const map = new Map(current);
            map.set(checkAssignment!.id, checkAssignment!);
            return map;
          });
        }
        const fingerprint = JSON.stringify({
          coordinationId: coordinationDetail.coordination.id,
          assignmentId: checkAssignment.id,
          version: checkAssignment.version
        });
        const attemptKey = coordinationAttemptKey(checkAssignment.id, fingerprint);
        const started = await startStoryCheckAttempt(
          buildStoryWorkCoordinationCheckAttemptInput({
            projectId,
            checkAssignment,
            callerIdempotencyKey: attemptKey
          }) as Parameters<typeof startStoryCheckAttempt>[0]
        );
        if (scope !== scopeEpoch.current) return;
        upsert(started.state.assignment);
        setCoordinationChildAssignments((current) => {
          const map = new Map(current);
          map.set(started.state.assignment.id, started.state.assignment);
          return map;
        });
        clearCoordinationAttemptKey(checkAssignment.id);
        await fetchAndApplyCoordinationDetail(coordinationDetail.coordination.id, {
          openReview: true,
          clearAttemptKeys: false
        });
        return;
      }
    } catch (cause) {
      if (scope === scopeEpoch.current) {
        setCoordinationError(
          cause instanceof Error
            ? cause.message
            : "The coordination action could not be completed."
        );
      }
    } finally {
      if (scope === scopeEpoch.current) setOperationPending(false);
    }
  }

  useEffect(() => { if (panelOpen) void refresh(); }, [panelOpen, refresh]);

  async function openReviewForArtifact(
    id: StoryWorkAssignmentId,
    assignment: StoryWorkAssignment,
    artifact: NonNullable<StoryWorkAssignment["currentArtifact"]>
  ) {
    if (!projectId) throw new Error("Open a project before reviewing story work.");
    if (isCheckStoryWorkAssignment(assignment)) {
      return openStoryCheckReview({
        projectId,
        assignmentId: id,
        expectedAssignmentVersion: assignment.version,
        artifact
      });
    }
    if (isCharacterStoryWorkAssignment(assignment)) {
      return reviewCharacterStoryWork({ projectId, assignmentId: id, expectedAssignmentVersion: assignment.version, artifact, action: "open" });
    }
    if (isOutlineStoryWorkAssignment(assignment)) {
      return reviewStoryStructureStoryWork({
        projectId,
        assignmentId: id,
        expectedAssignmentVersion: assignment.version,
        artifact,
        action: "open"
      });
    }
    return reviewSceneStoryWork({ projectId, assignmentId: id, expectedAssignmentVersion: assignment.version, artifact, action: "open" });
  }

  async function refreshAssignmentDetail(assignmentId: StoryWorkAssignmentId) {
    if (!projectId || operationPending) return;
    const scope = scopeEpoch.current;
    setOperationPending(true);
    setError(undefined);
    try {
      const next = await getStoryWorkAssignment(projectId, assignmentId);
      if (scope !== scopeEpoch.current) return;
      retryRequest.current = undefined;
      setDetail(next);
      upsert(next.assignment);
      setRecoveryNotice(undefined);
    } catch (cause) {
      if (scope === scopeEpoch.current) {
        setError(cause instanceof Error ? cause.message : "The assignment could not be refreshed.");
      }
    } finally {
      if (scope === scopeEpoch.current) setOperationPending(false);
    }
  }

  async function recoverStoryWork(action: StoryWorkRecoveryAction) {
    if (!projectId || !detail?.assignment || operationPending) return;
    const recovery = detail.recovery;
    if (recovery?.status !== "active-or-interrupted") return;
    const scope = scopeEpoch.current;
    setOperationPending(true);
    setError(undefined);
    try {
      const result = await recoverActiveStoryWorkAttempt({
        projectId,
        assignmentId: detail.assignment.id,
        expectedAssignmentVersion: recovery.expectedAssignmentVersion,
        runId: recovery.runId,
        action
      });
      if (scope !== scopeEpoch.current) return;
      retryRequest.current = undefined;
      setDetail({
        ...detail,
        assignment: result.assignment,
        attempt: result.attempt,
        run: result.run,
        recovery: undefined
      });
      upsert(result.assignment);
      setRecoveryNotice(storyWorkRecoverySuccessMessage(action, result.replayed));
    } catch (cause) {
      if (scope === scopeEpoch.current) {
        setError(messageForStoryWorkRecoveryFailure(cause));
      }
    } finally {
      if (scope === scopeEpoch.current) setOperationPending(false);
    }
  }

  async function openAssignment(
    id: StoryWorkAssignmentId,
    options: Readonly<{ fromCoordination?: boolean }> = {}
  ) {
    if (
      !projectId ||
      reviewDirty ||
      operationPending ||
      (coordinationReviewOpen && options.fromCoordination !== true)
    ) return;
    const scope = scopeEpoch.current;
    const sequence = ++openSequence.current;
    setError(undefined);
    setRecoveryNotice(undefined);
    retryRequest.current = undefined;
    try {
      let next = await getStoryWorkAssignment(projectId, id);
      if (scope !== scopeEpoch.current || sequence !== openSequence.current) return;
      if (next.assignment.status === "artifact-ready" && next.assignment.currentArtifact) {
        const opened = await openReviewForArtifact(id, next.assignment, next.assignment.currentArtifact);
        next = { ...next, ...opened };
      }
      if (scope !== scopeEpoch.current || sequence !== openSequence.current) return;
      setDetail(next); upsert(next.assignment); setReviewOpen(true);
      applyCharacterRequest.current = undefined; applySceneRequest.current = undefined;
      applyStructureRequest.current = undefined;
      clearStructurePreviewBinding();
      setSceneAppliedMode(inferSceneStoryWorkAppliedMode(next.assignment));
    } catch (cause) { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "The assignment could not be opened."); }
  }

  async function submit(brief: SubmitStoryWorkBrief) {
    if (!input.project) throw new Error("Open a project before starting story work.");
    const scope = scopeEpoch.current;

    if (brief.taskKind === "scene" && brief.coordinatedCheck !== undefined) {
      const createFingerprint = JSON.stringify({ projectId: input.project.id, ...brief });
      if (coordinationCreateRequest.current?.fingerprint !== createFingerprint) {
        coordinationCreateRequest.current = {
          fingerprint: createFingerprint,
          key: crypto.randomUUID()
        };
      }
      const createRequest = coordinationCreateRequest.current;
      setOperationPending(true);
      setCoordinationError(undefined);
      setCoordinationMessage(undefined);
      try {
        const availableSceneIds = new Set(
          input.project.books
            .filter((book) => book.archivedAt === undefined)
            .flatMap((book) => [
              ...book.parts.flatMap((part) =>
                part.chapters.flatMap((chapter) => chapter.scenes)
              ),
              ...book.unassignedScenes
            ])
            .filter((scene) => scene.archivedAt === undefined)
            .map((scene) => scene.id)
        );
        const createInput = buildStoryWorkCoordinationCreateInput({
          project: input.project,
          model: brief.model,
          sceneIds: brief.sceneIds,
          form: Object.freeze({
            coordinationTitle: COORDINATION_STRUCTURAL_TITLE,
            sceneTitle: COORDINATION_SCENE_STEP_TITLE,
            sceneBrief: brief.brief,
            sceneConstraints: brief.constraints,
            sceneDoneWhen: brief.doneWhen,
            checkTitle: COORDINATION_CHECK_STEP_TITLE,
            checkBrief: brief.coordinatedCheck.brief,
            checkConstraints: brief.coordinatedCheck.constraints,
            checkDoneWhen: brief.coordinatedCheck.doneWhen
          }),
          idempotencyKey: createRequest.key,
          availableSceneIds
        });
        const created = await createStoryWorkCoordination(createInput);
        if (scope !== scopeEpoch.current) return;
        upsert(created.rootAssignment);
        createRequest.coordinationId = created.coordination.id;
        await fetchAndApplyCoordinationDetail(created.coordination.id, { openReview: true });
        if (scope !== scopeEpoch.current) return;
        coordinationCreateRequest.current = undefined;
        submitRequest.current = undefined;
      } catch (cause) {
        if (scope === scopeEpoch.current) {
          if (cause instanceof StoryWorkCoordinationCreateInputError) throw cause;
          throw cause instanceof Error
            ? cause
            : new Error("Coordinated story work could not be created.");
        }
      } finally {
        if (scope === scopeEpoch.current) setOperationPending(false);
      }
      return;
    }

    const fingerprint = JSON.stringify({ projectId: input.project.id, ...brief });
    if (submitRequest.current?.fingerprint !== fingerprint) submitRequest.current = { fingerprint, key: crypto.randomUUID(), attemptKey: crypto.randomUUID() };
    const request = submitRequest.current;
    setOperationPending(true);
    try {
      if (!request.assignment) {
        const shared = {
          projectId: input.project.id,
          expectedProjectVersion: input.project.version,
          idempotencyKey: request.key,
          brief: brief.brief,
          constraints: brief.constraints,
          doneWhen: brief.doneWhen,
          sceneIds: brief.sceneIds,
          model: brief.model
        };
        let created;
        if (brief.taskKind === "character") {
          created = await createCharacterStoryWorkAssignment(shared);
        } else if (brief.taskKind === "check") {
          created = await createCheckStoryWorkAssignment(
            buildCheckStoryWorkCreateInput(input.project, brief, request.key)
          );
        } else if (brief.taskKind === "revise") {
          created = await createSceneStoryWorkAssignment({
            ...shared,
            taskKind: "revise",
            targetSceneId: brief.targetSceneId
          });
        } else if (brief.taskKind === "scene") {
          created = await createSceneStoryWorkAssignment({
            ...shared,
            taskKind: "scene"
          });
        } else if (brief.taskKind === "outline") {
          created = await createOutlineStoryWorkAssignment(
            buildOutlineStoryWorkCreateInput(input.project, brief, request.key)
          );
        } else {
          throw new Error("This story work task is not available yet.");
        }
        request.assignment = created.assignment;
      }
      if (scope !== scopeEpoch.current) return;
      upsert(request.assignment); setDetail({ assignment: request.assignment });
      const result = isCheckStoryWorkAssignment(request.assignment)
        ? await startStoryCheckAttempt({
            projectId: input.project.id,
            assignmentId: request.assignment.id,
            expectedAssignmentVersion: request.assignment.version,
            kind: "initial",
            sourceMode: "submitted-snapshot",
            instruction: request.assignment.brief,
            idempotencyKey: request.attemptKey
          })
        : isOutlineStoryWorkAssignment(request.assignment)
          ? await startStoryStructureAttempt({
              projectId: input.project.id,
              assignmentId: request.assignment.id,
              expectedAssignmentVersion: request.assignment.version,
              kind: "initial",
              sourceMode: "submitted-snapshot",
              instruction: request.assignment.brief,
              idempotencyKey: request.attemptKey
            })
          : await (isCharacterStoryWorkAssignment(request.assignment)
              ? startCharacterStoryWorkAttempt
              : startSceneStoryWorkAttempt)({
              projectId: input.project.id,
              assignmentId: request.assignment.id,
              expectedAssignmentVersion: request.assignment.version,
              kind: "initial",
              sourceMode: "submitted-snapshot",
              instruction: request.assignment.brief,
              idempotencyKey: request.attemptKey
            });
      if (scope !== scopeEpoch.current) return;
      upsert(result.state.assignment);
      const next = await getStoryWorkAssignment(input.project.id, request.assignment.id);
      if (scope !== scopeEpoch.current) return;
      setDetail(next);
      if (result.kind === "failed" || result.kind === "canceled" || result.kind === "stale") {
        setError("The assignment stopped without an applicable artifact. Open it to inspect the recorded outcome.");
      }
      submitRequest.current = undefined;
    } finally { if (scope === scopeEpoch.current) setOperationPending(false); }
  }

  async function refreshProjectAfterApply(assignmentId: StoryWorkAssignmentId, successCopy: string) {
    if (!projectId) return;
    try {
      const project = await getProject(projectId);
      if (scopeEpoch.current === renderEpoch) {
        input.onProjectChanged(project);
        setProjectRefreshError(undefined);
      }
    } catch {
      if (scopeEpoch.current === renderEpoch) {
        setProjectRefreshError({
          assignmentId,
          message: `${successCopy} The story view could not refresh; use Refresh saved review and story to load the acknowledged result.`
        });
      }
    }
  }

  async function applySceneReview(
    assignment: StoryWorkAssignment,
    applyInput: SceneReviewApplyRequest
  ) {
    if (!input.project || !projectId || assignment.destination.kind !== "scene") return;
    const sceneApply = input.storyWorkSceneApply;
    const artifactBase = Object.freeze({
      expectedAssignmentVersion: assignment.version,
      proposalId: applyInput.artifact.proposalId,
      expectedArtifactVersion: applyInput.artifact.artifactVersion,
      expectedProposalContentHash: applyInput.artifact.contentHash
    });

    const recordAppliedDetail = (applied: SceneStoryWorkApplyResult, mode: SceneReviewApplyRequest["mode"]) => {
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, assignment: applied.assignment, proposal: applied.proposal } : current);
      upsert(applied.assignment);
      setSceneAppliedMode(mode);
    };

    if (applyInput.mode === "create-scene") {
      refuseCreateSceneCanvasWhenRequested({
        placeOnCurrentCanvas: applyInput.placeOnCurrentCanvas,
        prepareCreateCanvasPlacement: sceneApply?.prepareCreateCanvasPlacement
      });
      let canvas: ApplySceneStoryWorkCanvasPlacement | undefined;
      if (applyInput.placeOnCurrentCanvas) {
        if (sceneApply === undefined) {
          throw new Error(
            "Canvas placement is unavailable. Turn off Place on current Canvas or open Canvas before creating this scene."
          );
        }
        canvas = await sceneApply.prepareCreateCanvasPlacement();
      }
      const semantic = sceneStoryWorkApplySemanticFingerprint({
        projectId,
        assignmentId: assignment.id,
        ...artifactBase,
        mode: "create-scene",
        expectedProjectVersion: input.project.version,
        title: applyInput.title,
        manuscriptPlacement: applyInput.manuscriptPlacement,
        ...(canvas === undefined ? {} : { canvas })
      });
      const idempotency = resolveSceneStoryWorkApplyIdempotencyKey({
        current: applySceneRequest.current,
        fingerprint: semantic
      });
      applySceneRequest.current = idempotency;
      const applied = await applySceneStoryWork({
        projectId,
        assignmentId: assignment.id,
        ...artifactBase,
        idempotencyKey: idempotency.key,
        mode: "create-scene",
        expectedProjectVersion: input.project.version,
        title: applyInput.title,
        manuscriptPlacement: applyInput.manuscriptPlacement,
        ...(canvas === undefined ? {} : { canvas })
      }).catch((cause) => {
        if (scopeEpoch.current === renderEpoch && cause instanceof GhostwriterApiError && cause.status < 500) {
          applySceneRequest.current = undefined;
        }
        throw cause;
      });
      recordAppliedDetail(applied, applyInput.mode);
      await refreshProjectAfterApply(assignment.id, "Scene created.");
      if (applyInput.placeOnCurrentCanvas) {
        try {
          await sceneApply?.refreshCanvas();
        } catch {
          if (scopeEpoch.current === renderEpoch) {
            setProjectRefreshError({
              assignmentId: assignment.id,
              message: "Scene created and acknowledged. Canvas could not refresh; reload Canvas to see the new card."
            });
          }
        }
      }
      return;
    }

    if (sceneApply === undefined) {
      throw new Error("Open this scene in Draft with its editing lease before applying a reviewed revision.");
    }
    const targetSceneId = assignment.destination.sceneId;
    const buildDispatchBody = (boundary: SceneStoryWorkDraftBoundary) => {
      const shared = {
        projectId,
        assignmentId: assignment.id,
        ...artifactBase,
        expectedSceneWorkingVersion: boundary.expectedWorkingVersion,
        expectedSceneContentHash: boundary.expectedContentHash
      };
      if (applyInput.mode === "named-variant") {
        return { ...shared, mode: "named-variant" as const, variantName: applyInput.variantName };
      }
      return { ...shared, mode: "apply-revision" as const };
    };

    const outcome = await runSceneStoryWorkUpdateApply({
      prepare: () => sceneApply.prepareUpdateTarget(targetSceneId),
      dispatch: async (boundary) => {
        const body = buildDispatchBody(boundary);
        const semantic = sceneStoryWorkApplySemanticFingerprint(body);
        const idempotency = resolveSceneStoryWorkApplyIdempotencyKey({
          current: applySceneRequest.current,
          fingerprint: semantic
        });
        applySceneRequest.current = idempotency;
        return applySceneStoryWork({ ...body, idempotencyKey: idempotency.key }).catch((cause) => {
          if (scopeEpoch.current === renderEpoch && cause instanceof GhostwriterApiError && cause.status < 500) {
            applySceneRequest.current = undefined;
          }
          throw cause;
        });
      },
      finish: () => sceneApply.finishUpdate()
    });

    if (outcome.kind === "prepare-refused") throw outcome.error;
    if (outcome.kind === "dispatch-failed") throw outcome.error;
    if (outcome.kind === "success") {
      recordAppliedDetail(outcome.result, applyInput.mode);
      await refreshProjectAfterApply(
        assignment.id,
        applyInput.mode === "named-variant" ? "Named variant saved." : "Draft revision applied."
      );
      return;
    }
    recordAppliedDetail(outcome.result, applyInput.mode);
    if (scopeEpoch.current === renderEpoch) {
      setProjectRefreshError({
        assignmentId: assignment.id,
        message: "Story work applied, but Draft could not refresh. Use Refresh saved review and story before writing again."
      });
    }
  }

  async function applyStructureReview(
    assignment: StoryWorkAssignment,
    applyInput: Readonly<{
      artifact: Readonly<{ proposalId: string; artifactVersion: number; contentHash: string }>;
      selectedOperationIds: readonly StoryStructureOperationId[];
      canvasSceneId?: SceneId;
    }>
  ) {
    if (!input.project || !projectId || assignment.destination.kind !== "book") return;
    const sceneApply = input.storyWorkSceneApply;
    const artifactBase = Object.freeze({
      expectedAssignmentVersion: assignment.version,
      proposalId: applyInput.artifact.proposalId,
      expectedArtifactVersion: applyInput.artifact.artifactVersion,
      expectedProposalContentHash: applyInput.artifact.contentHash
    });

    let canvas: ApplyStructureStoryWorkCanvasPlacement | undefined;
    if (applyInput.canvasSceneId !== undefined) {
      if (sceneApply === undefined) {
        throw new Error(
          "Canvas placement is unavailable. Turn off the Canvas card option or open Canvas before applying structure."
        );
      }
      const placement = await sceneApply.prepareCreateCanvasPlacement();
      if (scopeEpoch.current !== renderEpoch) return;
      canvas = Object.freeze({
        ...placement,
        sceneId: applyInput.canvasSceneId
      });
    }

    const semantic = structureApplySemanticFingerprint({
      projectId,
      assignmentId: assignment.id,
      ...artifactBase,
      expectedProjectVersion: input.project.version,
      selectedOperationIds: sortedStructureOperationIds(applyInput.selectedOperationIds),
      ...(canvas === undefined ? {} : { canvas })
    });
    const idempotency = resolveSceneStoryWorkApplyIdempotencyKey({
      current: applyStructureRequest.current,
      fingerprint: semantic
    });
    applyStructureRequest.current = idempotency;

    const applied = await applyStructureStoryWork({
      projectId,
      assignmentId: assignment.id,
      ...artifactBase,
      idempotencyKey: idempotency.key,
      expectedProjectVersion: input.project.version,
      selectedOperationIds: applyInput.selectedOperationIds,
      ...(canvas === undefined ? {} : { canvas })
    }).catch((cause) => {
      if (scopeEpoch.current === renderEpoch && cause instanceof GhostwriterApiError && cause.status < 500) {
        applyStructureRequest.current = undefined;
      }
      throw cause;
    });

    if (scopeEpoch.current !== renderEpoch) return;

    clearStructurePreviewBinding();

    setDetail((current) =>
      current ? { ...current, assignment: applied.assignment, proposal: applied.proposal } : current
    );
    upsert(applied.assignment);

    try {
      const refreshedProject = await getProject(projectId);
      if (scopeEpoch.current === renderEpoch) {
        input.onProjectChanged(refreshedProject);
        setProjectRefreshError(undefined);
      }
    } catch {
      if (scopeEpoch.current === renderEpoch) {
        setProjectRefreshError({
          assignmentId: assignment.id,
          message:
            "Structure applied. The story view could not refresh; use Refresh saved review and story to load the acknowledged result."
        });
      }
    }
    if (scopeEpoch.current !== renderEpoch) return;

    if (structureResultHasCanvasPlacement(applied.result)) {
      try {
        await sceneApply?.refreshCanvas();
      } catch {
        if (scopeEpoch.current === renderEpoch) {
          setProjectRefreshError({
            assignmentId: assignment.id,
            message:
              "Structure applied and acknowledged. Canvas could not refresh; reload Canvas to see the new card."
          });
        }
      }
    }
  }

  const scenes = input.project?.books.filter((book) => !book.archivedAt).flatMap((book) => [
    ...book.parts.flatMap((part) => part.chapters.flatMap((chapter) => chapter.scenes)), ...book.unassignedScenes
  ]).filter((scene) => !scene.archivedAt) ?? [];
  const activeProject = input.project;
  const proposalCheckTargets = useMemo(
    () =>
      activeProject
        ? buildProposalCheckTargets(assignments, (sceneId) =>
            sceneTitleInProject(activeProject, sceneId)
          )
        : [],
    [assignments, activeProject]
  );
  const outlineBooks = useMemo((): readonly StoryWorkOutlineBookOption[] => {
    if (!input.project) return Object.freeze([]);
    return Object.freeze(
      deriveOutlineStoryWorkActiveBooks(input.project).map((book) =>
        Object.freeze({ bookId: book.id, title: book.title })
      )
    );
  }, [input.project]);
  const selectedOutlineBookId = useMemo(
    () =>
      input.project
        ? deriveOutlineStoryWorkDefaultTargetBookId({
            navigator: input.project,
            selectedSceneId: input.selectedSceneId
          })
        : undefined,
    [input.project, input.selectedSceneId]
  );
  const coordinationSummaries = useMemo((): readonly StoryWorkCoordinationCardSummary[] => {
    return Object.freeze(
      coordinations.map((entry) => {
        const card = presentStoryWorkCoordinationCard({
          title: entry.coordination.title,
          projection: entry.projection
        });
        return Object.freeze({
          coordinationId: entry.coordination.id,
          title: card.title,
          statusLabel: card.status,
          detail: entry.rootAssignment.brief
        });
      })
    );
  }, [coordinations]);
  const coordinationReviewSteps = useMemo(
    () =>
      coordinationDetail === undefined
        ? Object.freeze([])
        : buildCoordinationReviewSteps(coordinationDetail, coordinationChildAssignments),
    [coordinationDetail, coordinationChildAssignments]
  );
  const panel = input.project ? <StoryWorkPanel key={scopeKey} open={panelOpen} projectTitle={input.project.title} supportedTaskKinds={["character", "scene", "outline", "revise", "check"]} models={input.models} selectedModel={input.model}
    selectedSceneId={input.selectedSceneId} scenes={scenes} outlineBooks={outlineBooks} selectedOutlineBookId={selectedOutlineBookId} proposalCheckTargets={proposalCheckTargets} prefill={revisePrefill} assignments={assignments} coordinationSummaries={coordinationSummaries} coordinationsLoading={coordinationsLoading} coordinationsError={coordinationsError} loading={loading} error={error}
    onSubmit={submit} onOpenCoordination={(id) => { void openCoordination(id); }} onOpenAssignment={(id) => { void openAssignment(id); }} onRefresh={() => { void refresh(); }} onBackToChat={() => { openSequence.current += 1; setPanelOpen(false); setCoordinationReviewOpen(false); }} onOpenSettings={input.onOpenSettings} /> : null;

  const assignment = detail?.assignment;
  const characterArtifact = detail?.proposal?.outputSchemaId === "character-create-v2" && assignment?.currentArtifact ? {
    pointer: assignment.currentArtifact, payload: validateCharacterCreateV2(detail.proposal.payload)
  } : undefined;
  const sceneArtifact = detail?.proposal?.outputSchemaId === "scene-draft-v1" && assignment?.currentArtifact ? {
    pointer: assignment.currentArtifact,
    payload: validateSceneDraftV1(detail.proposal.payload)
  } : undefined;
  const checkFreshness = detail?.checkFreshness;
  const checkArtifact =
    detail?.proposal?.outputSchemaId === "story-check-findings-v1" &&
    assignment?.currentArtifact &&
    checkFreshness !== undefined
      ? {
          pointer: assignment.currentArtifact,
          payload: validateStoryCheckFindingsV1(detail.proposal.payload)
        }
      : undefined;
  const structureArtifact =
    detail?.proposal?.outputSchemaId === "story-structure-proposal-v1" &&
    assignment?.currentArtifact
      ? {
          pointer: assignment.currentArtifact,
          payload: validateStoryStructureProposalV1(detail.proposal.payload)
        }
      : undefined;
  const structurePreviewBinding =
    structureArtifact !== undefined &&
    projectId !== undefined &&
    assignment !== undefined &&
    structurePreviewCache?.scopeKey ===
      structurePreviewScopeKey({
        projectId,
        assignmentId: assignment.id,
        proposalId: structureArtifact.pointer.proposalId,
        artifactVersion: structureArtifact.pointer.artifactVersion,
        contentHash: structureArtifact.pointer.contentHash
      })
      ? structurePreviewCache.binding
      : undefined;
  const structureAppliedPresentation = useMemo(
    () =>
      assignment !== undefined && input.project !== undefined
        ? inferStructureAppliedPresentation(assignment, input.project)
        : undefined,
    [assignment, input.project]
  );
  const checkReviewSceneLabels = scenes.map((scene) =>
    Object.freeze({ sceneId: scene.id, title: scene.title })
  );

  const characterReview = reviewOpen && assignment && projectId && isCharacterStoryWorkAssignment(assignment) ? characterArtifact && ["awaiting-review", "applied", "rejected"].includes(assignment.status) ? <CharacterStoryWorkReview key={assignment.id}
    artifact={characterArtifact} brief={assignment.brief} constraints={assignment.constraints} doneWhen={assignment.doneWhen}
    revisionInstruction={detail?.attempt?.kind === "revision" ? detail.attempt.instruction : undefined} refreshProblem={projectRefreshError?.assignmentId === assignment.id ? projectRefreshError.message : undefined} status={assignment.status === "applied" ? "applied" : assignment.status === "rejected" ? "rejected" : "review"}
    onDirtyChange={onReviewDirty} onBusyChange={onReviewBusy} onClose={() => closeReview(true)}
    onReload={async () => {
      const [next, project] = await Promise.all([getStoryWorkAssignment(projectId, assignment.id), getProject(projectId)]);
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail(next); upsert(next.assignment); input.onProjectChanged(project); applyCharacterRequest.current = undefined; setProjectRefreshError(undefined);
    }}
    onSave={async ({ artifact: pointer, payload }) => {
      const saved = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, payload, action: "edit" });
      if (scopeEpoch.current !== renderEpoch) throw new Error("This project is no longer open.");
      setDetail((current) => current ? { ...current, ...saved } : current); upsert(saved.assignment);
      return { pointer: saved.assignment.currentArtifact!, payload: validateCharacterCreateV2(saved.proposal.payload) };
    }}
    onReject={async (pointer) => {
      const rejected = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, action: "reject" });
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, ...rejected } : current); upsert(rejected.assignment);
    }}
    onApply={async (pointer) => {
      if (!input.project) return;
      const prior = applyCharacterRequest.current;
      const request = prior?.assignmentId === assignment.id && prior.proposalId === pointer.proposalId ? prior : {
        projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, expectedProjectVersion: input.project.version,
        proposalId: pointer.proposalId, expectedArtifactVersion: pointer.artifactVersion, expectedProposalContentHash: pointer.contentHash
      };
      applyCharacterRequest.current = request;
      const applied = await applyCharacterStoryWork(request).catch((cause) => {
        if (scopeEpoch.current === renderEpoch && cause instanceof GhostwriterApiError && cause.status < 500) applyCharacterRequest.current = undefined;
        throw cause;
      });
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, assignment: applied.assignment, proposal: applied.proposal } : current); upsert(applied.assignment);
      await refreshProjectAfterApply(assignment.id, "Added to Cast.");
    }}
    onRevise={async ({ artifact: pointer, instruction }) => {
      const fingerprint = JSON.stringify({ assignmentId: assignment.id, pointer, instruction });
      if (revisionRequest.current?.fingerprint !== fingerprint) revisionRequest.current = { fingerprint, key: crypto.randomUUID() };
      await startCharacterStoryWorkAttempt({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, kind: "revision", sourceMode: "latest-authorized", instruction, priorArtifact: pointer, idempotencyKey: revisionRequest.current.key });
      let next = await getStoryWorkAssignment(projectId, assignment.id);
      if (scopeEpoch.current !== renderEpoch) return;
      if (next.assignment.status === "artifact-ready" && next.assignment.currentArtifact) {
        const opened = await reviewCharacterStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: next.assignment.version, artifact: next.assignment.currentArtifact, action: "open" });
        next = { ...next, ...opened };
      }
      if (scopeEpoch.current !== renderEpoch) return;
      upsert(next.assignment); setDetail(next);
      setReviewOpen(true); revisionRequest.current = undefined;
    }}
    onOpenCharacter={() => {
      const result = assignment.results.find((entry) => entry.kind === "story-knowledge");
      if (result?.kind !== "story-knowledge") return;
      void getProject(projectId).then((project) => {
        if (scopeEpoch.current !== renderEpoch) return;
        input.onProjectChanged(project); setRequestedKnowledgeId(result.storyKnowledgeId); setReviewOpen(false);
      }).catch(() => { if (scopeEpoch.current === renderEpoch) setProjectRefreshError({ assignmentId: assignment.id, message: "The character is saved, but its dossier could not be opened. Refresh the story and try again." }); });
    }}
  /> : null : null;

  const sceneReview = reviewOpen && assignment && projectId && input.project && isSceneStoryWorkAssignment(assignment) ? sceneArtifact && ["awaiting-review", "applied", "rejected"].includes(assignment.status) ? <SceneStoryWorkReview key={assignment.id}
    artifact={sceneArtifact}
    destination={sceneReviewDestination(input.project, assignment, input.sceneCanvasDescriptor)}
    sourceScenes={sceneArtifact.payload.sourceSceneIds.map((sceneId) => Object.freeze({
      sceneId,
      title: sceneTitleInProject(input.project!, sceneId) ?? String(sceneId)
    }))}
    brief={assignment.brief}
    constraints={assignment.constraints}
    doneWhen={assignment.doneWhen}
    revisionInstruction={detail?.attempt?.kind === "revision" ? detail.attempt.instruction : undefined}
    revisionPrefill={
      projectId !== undefined &&
      sceneReviewRevisionPrefill?.scopeKey ===
        sceneStoryWorkRevisionPrefillScopeKey(projectId, assignment.id)
        ? sceneReviewRevisionPrefill.prefill
        : undefined
    }
    refreshProblem={projectRefreshError?.assignmentId === assignment.id ? projectRefreshError.message : undefined}
    status={assignment.status === "applied" ? "applied" : assignment.status === "rejected" ? "rejected" : "review"}
    appliedMode={resolveSceneStoryWorkAppliedMode({ assignment, sessionMode: sceneAppliedMode })}
    onDirtyChange={onReviewDirty}
    onBusyChange={onReviewBusy}
    onClose={() => closeReview(true)}
    onReload={async () => {
      const [next, project] = await Promise.all([getStoryWorkAssignment(projectId, assignment.id), getProject(projectId)]);
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail(next); upsert(next.assignment); input.onProjectChanged(project); applySceneRequest.current = undefined; setProjectRefreshError(undefined);
      setSceneAppliedMode(inferSceneStoryWorkAppliedMode(next.assignment));
    }}
    onSave={async ({ artifact: pointer, payload }) => {
      const saved = await reviewSceneStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, payload, action: "edit" });
      if (scopeEpoch.current !== renderEpoch) throw new Error("This project is no longer open.");
      setDetail((current) => current ? { ...current, ...saved } : current); upsert(saved.assignment);
      return { pointer: saved.assignment.currentArtifact!, payload: validateSceneDraftV1(saved.proposal.payload) };
    }}
    onReject={async (pointer) => {
      const rejected = await reviewSceneStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, artifact: pointer, action: "reject" });
      if (scopeEpoch.current !== renderEpoch) return;
      setDetail((current) => current ? { ...current, ...rejected } : current); upsert(rejected.assignment);
    }}
    onApply={async (applyInput) => {
      await applySceneReview(assignment, applyInput);
    }}
    onRevise={async ({ artifact: pointer, instruction }) => {
      if (
        projectId !== undefined &&
        sceneReviewRevisionPrefill?.scopeKey ===
          sceneStoryWorkRevisionPrefillScopeKey(projectId, assignment.id)
      ) {
        setSceneReviewRevisionPrefill(undefined);
      }
      const fingerprint = JSON.stringify({ assignmentId: assignment.id, pointer, instruction });
      if (revisionRequest.current?.fingerprint !== fingerprint) revisionRequest.current = { fingerprint, key: crypto.randomUUID() };
      await startSceneStoryWorkAttempt({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, kind: "revision", sourceMode: "latest-authorized", instruction, priorArtifact: pointer, idempotencyKey: revisionRequest.current.key });
      let next = await getStoryWorkAssignment(projectId, assignment.id);
      if (scopeEpoch.current !== renderEpoch) return;
      if (next.assignment.status === "artifact-ready" && next.assignment.currentArtifact) {
        const opened = await reviewSceneStoryWork({ projectId, assignmentId: assignment.id, expectedAssignmentVersion: next.assignment.version, artifact: next.assignment.currentArtifact, action: "open" });
        next = { ...next, ...opened };
      }
      if (scopeEpoch.current !== renderEpoch) return;
      upsert(next.assignment); setDetail(next);
      setReviewOpen(true); revisionRequest.current = undefined;
    }}
    onOpenResult={() => {
      const result = assignment.results.find((entry) => entry.kind === "scene");
      if (result?.kind !== "scene") return;
      closeReview(false);
      setPanelOpen(false);
      input.storyWorkSceneApply?.openScene(result.sceneId);
    }}
  /> : null : null;

  const structureReview =
    reviewOpen && assignment && projectId && input.project && isOutlineStoryWorkAssignment(assignment)
      ? structureArtifact &&
        ["awaiting-review", "applied", "rejected"].includes(assignment.status)
        ? <StoryStructureReview
            key={assignment.id}
            artifact={structureArtifact}
            bookLabel={
              assignment.destination.kind === "book"
                ? bookTitleInProject(input.project, assignment.destination.bookId) ?? "Selected book"
                : "Selected book"
            }
            brief={assignment.brief}
            constraints={assignment.constraints}
            doneWhen={assignment.doneWhen}
            preview={structurePreviewBinding}
            appliedProjectVersion={
              structureAppliedPresentation?.appliedProjectVersion ??
              inferStructureAppliedProjectVersion(assignment)
            }
            appliedFirstCreatedSceneId={structureAppliedPresentation?.firstCreatedSceneId}
            canvasPlacedSceneLabel={structureAppliedPresentation?.canvasPlacedSceneLabel}
            refreshProblem={
              projectRefreshError?.assignmentId === assignment.id
                ? projectRefreshError.message
                : undefined
            }
            status={
              assignment.status === "applied"
                ? "applied"
                : assignment.status === "rejected"
                  ? "rejected"
                  : "review"
            }
            onDirtyChange={onReviewDirty}
            onBusyChange={onReviewBusy}
            onClose={() => closeReview(true)}
            onReload={async () => {
              const [next, project] = await Promise.all([
                getStoryWorkAssignment(projectId, assignment.id),
                getProject(projectId)
              ]);
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return;
              setDetail(next);
              upsert(next.assignment);
              input.onProjectChanged(project);
              applyStructureRequest.current = undefined;
              clearStructurePreviewBinding();
              setProjectRefreshError(undefined);
              const reloadedStructure = storyStructureWorkResult(next.assignment);
              if (
                reloadedStructure !== undefined &&
                structureResultHasCanvasPlacement(reloadedStructure)
              ) {
                try {
                  await input.storyWorkSceneApply?.refreshCanvas();
                } catch {
                  if (scopeEpoch.current === renderEpoch) {
                    setProjectRefreshError({
                      assignmentId: assignment.id,
                      message:
                        "Structure review refreshed, but Canvas could not reload. Open Canvas again to see placement."
                    });
                  }
                }
              }
            }}
            onEdit={async (payload) => {
              const saved = await reviewStoryStructureStoryWork({
                projectId,
                assignmentId: assignment.id,
                expectedAssignmentVersion: assignment.version,
                artifact: structureArtifact.pointer,
                action: "edit",
                payload
              });
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) {
                throw new Error("This project is no longer open.");
              }
              clearStructurePreviewBinding();
              setDetail((current) => (current ? { ...current, ...saved } : current));
              upsert(saved.assignment);
              return {
                pointer: saved.assignment.currentArtifact!,
                payload: validateStoryStructureProposalV1(saved.proposal.payload)
              };
            }}
            onPreview={async (selectedOperationIds) => {
              if (!input.project) return undefined;
              const previewResult = await previewStoryStructureStoryWork({
                projectId,
                assignmentId: assignment.id,
                expectedAssignmentVersion: assignment.version,
                expectedProjectVersion: input.project.version,
                artifact: structureArtifact.pointer,
                selectedOperationIds
              });
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return undefined;
              const binding = Object.freeze({
                fingerprint: storyStructurePreviewCacheFingerprint({
                  artifact: structureArtifact.pointer,
                  payload: structureArtifact.payload,
                  selectedOperationIds
                }),
                preview: previewResult.preview
              });
              setStructurePreviewCache(
                Object.freeze({
                  scopeKey: structurePreviewScopeKey({
                    projectId,
                    assignmentId: assignment.id,
                    proposalId: structureArtifact.pointer.proposalId,
                    artifactVersion: structureArtifact.pointer.artifactVersion,
                    contentHash: structureArtifact.pointer.contentHash
                  }),
                  binding
                })
              );
              return binding;
            }}
            onReject={async (pointer) => {
              const rejected = await reviewStoryStructureStoryWork({
                projectId,
                assignmentId: assignment.id,
                expectedAssignmentVersion: assignment.version,
                artifact: pointer,
                action: "reject"
              });
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return;
              clearStructurePreviewBinding();
              setDetail((current) => (current ? { ...current, ...rejected } : current));
              upsert(rejected.assignment);
            }}
            onApply={async (applyInput) => {
              await applyStructureReview(assignment, {
                artifact: structureArtifact.pointer,
                selectedOperationIds: applyInput.selectedOperationIds,
                canvasSceneId: applyInput.canvasSceneId
              });
            }}
            onOpenScene={(sceneId) => {
              closeReview(false);
              setPanelOpen(false);
              input.storyWorkNavigation?.openScene({ sceneId });
            }}
          />
        : null
      : null;

  const checkReview =
    reviewOpen && assignment && projectId && input.project && isCheckStoryWorkAssignment(assignment)
      ? checkArtifact &&
        ["artifact-ready", "awaiting-review", "reviewed", "rejected"].includes(assignment.status)
        ? <StoryCheckReview
            key={assignment.id}
            artifact={checkArtifact}
            freshness={checkFreshness!}
            sceneLabels={checkReviewSceneLabels}
            brief={assignment.brief}
            constraints={assignment.constraints}
            doneWhen={assignment.doneWhen}
            refreshProblem={
              projectRefreshError?.assignmentId === assignment.id
                ? projectRefreshError.message
                : undefined
            }
            status={
              assignment.status === "reviewed"
                ? "reviewed"
                : assignment.status === "rejected"
                  ? "rejected"
                  : "review"
            }
            onDirtyChange={onReviewDirty}
            onBusyChange={onReviewBusy}
            onClose={() => closeReview(true)}
            onReload={async () => {
              const [next, project] = await Promise.all([
                getStoryWorkAssignment(projectId, assignment.id),
                getProject(projectId)
              ]);
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return;
              setDetail(next);
              upsert(next.assignment);
              input.onProjectChanged(project);
              setProjectRefreshError(undefined);
            }}
            onResolve={async (resolveInput) => {
              const resolved = await resolveStoryCheckFinding({
                projectId,
                assignmentId: assignment.id,
                findingId: resolveInput.findingId,
                expectedAssignmentVersion: assignment.version,
                artifact: resolveInput.artifact,
                resolution: resolveInput.resolution
              });
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) {
                throw new Error("This project is no longer open.");
              }
              setDetail((current) =>
                current
                  ? { ...current, assignment: resolved.assignment, proposal: resolved.proposal }
                  : current
              );
              upsert(resolved.assignment);
              const pointer = resolved.assignment.currentArtifact;
              if (pointer === undefined) {
                throw new Error("The check artifact is unavailable after saving.");
              }
              return {
                pointer,
                payload: validateStoryCheckFindingsV1(resolved.proposal.payload)
              };
            }}
            onComplete={async (pointer) => {
              const completed = await completeStoryCheckReview({
                projectId,
                assignmentId: assignment.id,
                expectedAssignmentVersion: assignment.version,
                artifact: pointer
              });
              if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return;
              setDetail((current) =>
                current
                  ? { ...current, assignment: completed.assignment, proposal: completed.proposal }
                  : current
              );
              upsert(completed.assignment);
            }}
            onOpenScene={(openInput) => {
              closeReview(false);
              setPanelOpen(false);
              input.storyWorkNavigation?.openScene(openInput);
            }}
            onOpenStoryIntent={(openInput) => {
              closeReview(false);
              setPanelOpen(false);
              input.storyWorkNavigation?.openStoryIntent?.(openInput);
            }}
            onStartRevisionAssignment={({ findingId, prefilledBrief }) => {
              const finding = checkArtifact.payload.findings.find(
                (entry) => entry.id === findingId
              );
              if (finding === undefined || !projectId) return;
              const followUp = chooseStoryCheckRevisionFollowUp(checkArtifact.payload);
              if (followUp.kind === "story-work-panel-revise") {
                setRevisePrefill(
                  deriveStoryCheckRevisionPrefill({
                    requestToken: crypto.randomUUID(),
                    payload: checkArtifact.payload,
                    finding,
                    prefilledBrief,
                    constraints: assignment.constraints,
                    doneWhen: STORY_CHECK_REVISION_DONE_WHEN
                  })
                );
                closeReview(false);
                setPanelOpen(true);
                return;
              }
              void (async () => {
                const checkDetailSnapshot = detail;
                setOperationPending(true);
                try {
                  const sourceDetail = await getStoryWorkAssignment(
                    projectId,
                    followUp.sourceAssignmentId
                  );
                  if (storyWorkScopeEpochMismatch(scopeEpoch.current, renderEpoch)) return;
                  const validation = validateProposalDraftRevisionFollowUp(
                    sourceDetail.assignment,
                    followUp.sourceArtifact
                  );
                  if (!validation.ok) {
                    setError(validation.message);
                    return;
                  }
                  if (!isSceneStoryWorkAssignment(sourceDetail.assignment)) {
                    setError(
                      "The checked proposal assignment is unavailable. Refresh story work and try again."
                    );
                    return;
                  }
                  closeReview(false);
                  setPanelOpen(false);
                  const prefillScope = sceneStoryWorkRevisionPrefillScopeKey(
                    projectId,
                    followUp.sourceAssignmentId
                  );
                  setSceneReviewRevisionPrefill(
                    Object.freeze({
                      scopeKey: prefillScope,
                      prefill: Object.freeze({
                        requestToken: crypto.randomUUID(),
                        instruction: prefilledBrief
                      })
                    })
                  );
                  const scope = scopeEpoch.current;
                  const sequence = ++openSequence.current;
                  let next = sourceDetail;
                  if (
                    next.assignment.status === "artifact-ready" &&
                    next.assignment.currentArtifact
                  ) {
                    const opened = await openReviewForArtifact(
                      followUp.sourceAssignmentId,
                      next.assignment,
                      next.assignment.currentArtifact
                    );
                    next = { ...next, ...opened };
                  }
                  if (
                    scope !== scopeEpoch.current ||
                    sequence !== openSequence.current
                  ) {
                    setSceneReviewRevisionPrefill(undefined);
                    return;
                  }
                  setDetail(next);
                  upsert(next.assignment);
                  setReviewOpen(true);
                  applyCharacterRequest.current = undefined;
                  applySceneRequest.current = undefined;
                  setSceneAppliedMode(inferSceneStoryWorkAppliedMode(next.assignment));
                  setError(undefined);
                } catch (cause) {
                  setSceneReviewRevisionPrefill(undefined);
                  if (checkDetailSnapshot !== undefined) {
                    setDetail(checkDetailSnapshot);
                    setReviewOpen(true);
                  }
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "The source proposal review could not be opened."
                  );
                } finally {
                  if (scopeEpoch.current === renderEpoch) setOperationPending(false);
                }
              })();
            }}
          />
        : null
      : null;

  const coordinationReview =
    coordinationReviewOpen && coordinationDetail && projectId ? (
      <StoryWorkCoordinationReview
        key={coordinationDetail.coordination.id}
        coordinationTitle={coordinationDetail.coordination.title}
        coordinationStatusLabel={
          presentStoryWorkCoordinationCard({
            title: coordinationDetail.coordination.title,
            projection: coordinationDetail.projection
          }).status
        }
        coordinationVersion={coordinationDetail.projection.version}
        steps={coordinationReviewSteps}
        busy={operationPending}
        error={coordinationError}
        message={coordinationMessage}
        onAction={(stepId, kind) => {
          void runCoordinationStepAction(stepId, kind);
        }}
        onRefresh={() => {
          void refreshCoordinationDetailOnly();
        }}
        onClose={() => {
          closeCoordinationReview(true);
        }}
      />
    ) : null;

  const reloadRecovery =
    reviewOpen && assignment
      ? presentStoryWorkReloadRecovery({
          assignmentStatus: assignment.status,
          recovery: detail?.recovery,
          runId: detail?.run?.id
        })
      : undefined;
  const nonReviewableStatusLine =
    assignment !== undefined
      ? storyWorkNonReviewableStatusLine({
          assignmentStatus: assignment.status,
          terminalDiagnosticCode: detail?.run?.terminalDiagnosticCode
        })
      : "";
  const showStoryWorkRetry =
    assignment !== undefined &&
    storyWorkReloadRecoveryShowsRetry({
      assignmentStatus: assignment.status,
      terminalDiagnosticCode: detail?.run?.terminalDiagnosticCode
    });

  const review =
    coordinationReview ??
    characterReview ??
    sceneReview ??
    structureReview ??
    checkReview ??
    (reviewOpen && assignment && projectId ? <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 40, gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontFamily: ghostwriterTheme.fonts.story, fontSize: 26, lineHeight: 36 }}>{storyWorkTaskLabel(assignment.taskKind)} assignment</Text>
    <Text>{assignment.brief}</Text><Text>Constraints: {assignment.constraints}</Text><Text>Done when: {assignment.doneWhen}</Text><Text>Status: {assignment.status}</Text>
    {detail?.attempt?.kind === "revision" ? <Text>Revision request: {detail.attempt.instruction}</Text> : null}
    {reloadRecovery ? <View accessibilityLabel="Generation recovery" style={{ gap: 10 }}>
      <Text>{reloadRecovery.message}</Text>
      {reloadRecovery.technicalRunId ? <Text style={{ fontFamily: ghostwriterTheme.fonts.ui, fontSize: 12, color: ghostwriterTheme.colors.muted }}>Run ID: {reloadRecovery.technicalRunId}</Text> : null}
      <Pressable accessibilityRole="button" disabled={operationPending || !reloadRecovery.actions.refresh} onPress={() => { void refreshAssignmentDetail(assignment.id); }}>
        <Text>{operationPending ? "Working…" : "Refresh status"}</Text>
      </Pressable>
      {reloadRecovery.actions.cancel ? <Pressable accessibilityRole="button" accessibilityHint={reloadRecovery.cancelAccessibilityHint} disabled={operationPending} onPress={() => { void recoverStoryWork("cancel"); }}>
        <Text>Cancel generation</Text>
      </Pressable> : null}
      {reloadRecovery.actions.markInterrupted ? <Pressable accessibilityRole="button" disabled={operationPending} onPress={() => { void recoverStoryWork("mark-interrupted"); }}>
        <Text style={{ color: ghostwriterTheme.colors.red, fontFamily: ghostwriterTheme.fonts.uiMedium }}>Mark interrupted</Text>
      </Pressable> : null}
    </View> : null}
    {!reloadRecovery ? <Text>{nonReviewableStatusLine}</Text> : null}
    {recoveryNotice ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert">{recoveryNotice}</Text> : null}
    {showStoryWorkRetry ? <Pressable accessibilityRole="button" disabled={operationPending} onPress={() => {
      if (operationPending) return;
      setOperationPending(true);
      const scope = scopeEpoch.current;
      let retry;
      try { retry = { projectId, assignmentId: assignment.id, expectedAssignmentVersion: assignment.version, ...storyWorkRetryInput(assignment, detail?.attempt) }; }
      catch (cause) { setError(cause instanceof Error ? cause.message : "The recorded request is unavailable."); setOperationPending(false); return; }
      const fingerprint = JSON.stringify(retry);
      if (retryRequest.current?.fingerprint !== fingerprint) retryRequest.current = { fingerprint, key: crypto.randomUUID() };
      const startCheck = isCheckStoryWorkAssignment(assignment);
      const startOutline = isOutlineStoryWorkAssignment(assignment);
      if (startCheck && retry.kind !== "initial") {
        setError("This check cannot be retried from a revision request. Refresh the assignment first.");
        setOperationPending(false);
        return;
      }
      if (startOutline && retry.kind !== "initial") {
        setError("Outline work cannot be retried from a revision request. Refresh the assignment first.");
        setOperationPending(false);
        return;
      }
      const retryPromise = startCheck
        ? startStoryCheckAttempt({
            projectId: retry.projectId,
            assignmentId: retry.assignmentId,
            expectedAssignmentVersion: retry.expectedAssignmentVersion,
            kind: "initial",
            sourceMode: "submitted-snapshot",
            instruction: retry.instruction,
            idempotencyKey: retryRequest.current.key
          })
        : startOutline
          ? startStoryStructureAttempt({
              projectId: retry.projectId,
              assignmentId: retry.assignmentId,
              expectedAssignmentVersion: retry.expectedAssignmentVersion,
              kind: "initial",
              sourceMode: "submitted-snapshot",
              instruction: retry.instruction,
              idempotencyKey: retryRequest.current.key
            })
          : (isCharacterStoryWorkAssignment(assignment)
              ? startCharacterStoryWorkAttempt
              : startSceneStoryWorkAttempt)({
              ...retry,
              idempotencyKey: retryRequest.current.key
            });
      void retryPromise
      .then(async () => { const next = await getStoryWorkAssignment(projectId, assignment.id); if (scope === scopeEpoch.current) { setDetail(next); upsert(next.assignment); retryRequest.current = undefined; } })
        .catch((cause) => { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "The attempt could not be started."); })
        .finally(() => { if (scope === scopeEpoch.current) setOperationPending(false); });
    }}><Text>{operationPending ? "Working…" : assignment.status === "brief-ready" ? "Start this assignment" : "Try another generation"}</Text></Pressable> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={operationPending} onPress={() => { void refreshAssignmentDetail(assignment.id); }}><Text>Refresh assignment</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => closeReview(true)}><Text>Back to story</Text></Pressable>
  </ScrollView> : null);

  return { panelOpen, panel, review, dirty: reviewDirty, pending: operationPending, requestedKnowledgeId,
    clearRequestedKnowledge: () => setRequestedKnowledgeId(undefined), open: () => setPanelOpen(true),
    closeReview: () => closeReview(false), refresh };
}
