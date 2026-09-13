import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
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
  type StoryWorkTaskKind
} from "@ghostwriter/core";
import {
  CharacterStoryWorkReview,
  SceneStoryWorkReview,
  STORY_WORK_HEADING_NATIVE_ID,
  StoryCheckReview,
  StoryStructureReview,
  StoryWorkPanel,
  ghostwriterTheme,
  storyWorkAssignmentButtonNativeId,
  type SceneReviewApplyRequest,
  type SceneReviewDestination,
  type SceneStoryWorkRevisionPrefill,
  type StoryStructureReviewPreviewBinding,
  type StoryWorkOutlineBookOption,
  type StoryWorkPanelRevisePrefill,
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
  completeStoryCheckReview,
  createCharacterStoryWorkAssignment,
  createCheckStoryWorkAssignment,
  createOutlineStoryWorkAssignment,
  createSceneStoryWorkAssignment,
  getProject,
  getStoryWorkAssignment,
  listStoryWorkAssignments,
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
  type StoryWorkDetailResponse
} from "./api.js";
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
  const [structurePreviewCache, setStructurePreviewCache] = useState<
    Readonly<{ scopeKey: string; binding: StoryStructureReviewPreviewBinding }> | undefined
  >(undefined);

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
    const epoch = scopeEpoch.current;
    setReviewOpen(false);
    if (!restoreFocus) return;
    returnFocusTimer.current = setTimeout(() => {
      returnFocusTimer.current = undefined;
      if (scopeEpoch.current !== epoch) return;
      if (
        assignmentId !== undefined &&
        focusVisibleStoryWorkTarget(storyWorkAssignmentButtonNativeId(assignmentId))
      ) return;
      focusVisibleStoryWorkTarget(STORY_WORK_HEADING_NATIVE_ID);
    }, 30);
  }

  useEffect(() => {
    cancelReturnFocus();
    setProjectRefreshError(undefined); retryRequest.current = undefined;
    setPanelOpen(false); setAssignments([]); setDetail(undefined); setReviewOpen(false); setReviewDirty(false); setError(undefined);
    setRequestedKnowledgeId(undefined); submitRequest.current = undefined; revisionRequest.current = undefined;
    applyCharacterRequest.current = undefined; applySceneRequest.current = undefined;
    applyStructureRequest.current = undefined;
    setSceneAppliedMode(undefined);
    setRevisePrefill(undefined);
    setSceneReviewRevisionPrefill(undefined);
    clearStructurePreviewBinding();
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
    try { const next = await listStoryWorkAssignments(projectId); if (scope === scopeEpoch.current) { setAssignments(next); setError(undefined); } }
    catch (cause) { if (scope === scopeEpoch.current) setError(cause instanceof Error ? cause.message : "Assignments could not be loaded."); }
    finally { if (scope === scopeEpoch.current) setLoading(false); }
  }, [projectId]);

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

  async function openAssignment(id: StoryWorkAssignmentId) {
    if (!projectId || reviewDirty || operationPending) return;
    const scope = scopeEpoch.current;
    const sequence = ++openSequence.current;
    setError(undefined);
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
          created = await createSceneStoryWorkAssignment({ ...shared, taskKind: "scene" });
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
  const panel = input.project ? <StoryWorkPanel key={scopeKey} open={panelOpen} projectTitle={input.project.title} supportedTaskKinds={["character", "scene", "outline", "revise", "check"]} models={input.models} selectedModel={input.model}
    selectedSceneId={input.selectedSceneId} scenes={scenes} outlineBooks={outlineBooks} selectedOutlineBookId={selectedOutlineBookId} proposalCheckTargets={proposalCheckTargets} prefill={revisePrefill} assignments={assignments} loading={loading} error={error}
    onSubmit={submit} onOpenAssignment={(id) => { void openAssignment(id); }} onRefresh={() => { void refresh(); }} onBackToChat={() => { openSequence.current += 1; setPanelOpen(false); }} onOpenSettings={input.onOpenSettings} /> : null;

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

  const review = characterReview ?? sceneReview ?? structureReview ?? checkReview ?? (reviewOpen && assignment && projectId ? <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontFamily: ghostwriterTheme.fonts.story, fontSize: 26 }}>{storyWorkTaskLabel(assignment.taskKind)} assignment</Text>
    <Text>{assignment.brief}</Text><Text>Constraints: {assignment.constraints}</Text><Text>Done when: {assignment.doneWhen}</Text><Text>Status: {assignment.status}</Text>
    {detail?.attempt?.kind === "revision" ? <Text>Revision request: {detail.attempt.instruction}</Text> : null}
    <Text>{detail?.run?.terminalDiagnosticCode ?? "No reviewable artifact is available yet."}</Text>
    {["brief-ready", "failed", "canceled", "stale"].includes(assignment.status) ? <Pressable accessibilityRole="button" disabled={operationPending} onPress={() => {
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
    <Pressable accessibilityRole="button" onPress={() => { void openAssignment(assignment.id); }}><Text>Refresh assignment</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => closeReview(true)}><Text>Back to story</Text></Pressable>
  </ScrollView> : null);

  return { panelOpen, panel, review, dirty: reviewDirty, pending: operationPending, requestedKnowledgeId,
    clearRequestedKnowledge: () => setRequestedKnowledgeId(undefined), open: () => setPanelOpen(true),
    closeReview: () => closeReview(false), refresh };
}
