import type {
  NarrativeBeatId,
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  SceneId,
  SceneIntentPatch,
  StoryContextBeatProjection,
  StoryContextProjection,
  StoryContextSceneIntent,
  StoryKnowledgeId
} from "@ghostwriter/core";

export const STORY_CONTEXT_THREAD_CHOICE_LIMIT = 20;
export const STORY_CONTEXT_DEPENDENCY_CHOICE_LIMIT = 20;
export const STORY_CONTEXT_DIRTY_NAVIGATION_MESSAGE =
  "Save or discard Story context edits first";

export type StoryContextSurface = "draft" | "canvas";
export type StoryContextDirtySurfaces = Readonly<
  Record<StoryContextSurface, boolean>
>;

export function createStoryContextDirtySurfaces(): StoryContextDirtySurfaces {
  return Object.freeze({ draft: false, canvas: false });
}

export function setStoryContextSurfaceDirty(
  current: StoryContextDirtySurfaces,
  surface: StoryContextSurface,
  dirty: boolean
): StoryContextDirtySurfaces {
  if (current[surface] === dirty) return current;
  return Object.freeze({ ...current, [surface]: dirty });
}

export function hasDirtyStoryContextSurface(
  current: StoryContextDirtySurfaces
): boolean {
  return current.draft || current.canvas;
}

export type StoryIntentDraft = Readonly<{
  purpose: string;
  conflict: string;
  turn: string;
  openQuestions: string;
}>;

export type StoryEditStatus =
  | "ready"
  | "editing"
  | "saving"
  | "saved"
  | "not-saved"
  | "canonical-changed";

export type StoryIntentEditState = Readonly<{
  sceneId: SceneId;
  projectVersion: number;
  base: StoryIntentDraft;
  draft: StoryIntentDraft;
  status: StoryEditStatus;
  submitted?: StoryIntentDraft;
  incoming?: Readonly<{
    sceneId: SceneId;
    projectVersion: number;
    value: StoryIntentDraft;
  }>;
}>;

export type StoryTextEditState = Readonly<{
  identity: string;
  projectVersion: number;
  base: string;
  draft: string;
  status: StoryEditStatus;
  submitted?: string;
  incoming?: Readonly<{
    identity: string;
    projectVersion: number;
    value: string;
  }>;
}>;

export type StoryThreadChoice = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  relevant: boolean;
  archived: boolean;
}>;

export type NarrativeDependencyChoice = Readonly<{
  id: NarrativeBeatId;
  label: string;
  archived: boolean;
  sceneArchived: boolean;
}>;

export type StoryNarrativeBeatSubmission = Readonly<{
  projectVersion: number;
  threadId: StoryKnowledgeId;
  sceneId: SceneId;
  beatId?: NarrativeBeatId;
  role: "setup" | "development" | "payoff" | "consequence";
  summary: string;
  dependencyIds: readonly NarrativeBeatId[];
  existingBeatIds: readonly NarrativeBeatId[];
}>;

type NarrativeBeatValue = Readonly<{
  id: NarrativeBeatId;
  sceneId: SceneId;
  role: StoryNarrativeBeatSubmission["role"];
  summary: string;
  dependsOnBeatIds: readonly NarrativeBeatId[];
}>;

function normalized(value: string): string {
  return value.trim();
}

function intentValue(value: StoryContextSceneIntent): StoryIntentDraft {
  return Object.freeze({
    purpose: value.purpose ?? "",
    conflict: value.conflict ?? "",
    turn: value.turn ?? "",
    openQuestions: value.openQuestions ?? ""
  });
}

function sameIntent(left: StoryIntentDraft, right: StoryIntentDraft): boolean {
  return (
    normalized(left.purpose) === normalized(right.purpose) &&
    normalized(left.conflict) === normalized(right.conflict) &&
    normalized(left.turn) === normalized(right.turn) &&
    normalized(left.openQuestions) === normalized(right.openQuestions)
  );
}

function sameIds(
  left: readonly NarrativeBeatId[],
  right: readonly NarrativeBeatId[]
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function storyNarrativeDraftMatchesSubmission(
  draft: Readonly<{
    threadId?: StoryKnowledgeId;
    sceneId: SceneId;
    beatId?: NarrativeBeatId;
    role: StoryNarrativeBeatSubmission["role"];
    summary: string;
    dependencyIds: readonly NarrativeBeatId[];
  }>,
  submission: StoryNarrativeBeatSubmission
): boolean {
  return (
    draft.threadId === submission.threadId &&
    draft.sceneId === submission.sceneId &&
    (submission.beatId === undefined || draft.beatId === submission.beatId) &&
    draft.role === submission.role &&
    normalized(draft.summary) === normalized(submission.summary) &&
    sameIds(draft.dependencyIds, submission.dependencyIds)
  );
}

export function acknowledgedNarrativeBeatId(
  submission: StoryNarrativeBeatSubmission,
  beats: readonly NarrativeBeatValue[]
): NarrativeBeatId | undefined {
  const existingIds = new Set(submission.existingBeatIds);
  const matches = beats.filter(
    (beat) =>
      (submission.beatId === undefined
        ? !existingIds.has(beat.id)
        : beat.id === submission.beatId) &&
      beat.sceneId === submission.sceneId &&
      beat.role === submission.role &&
      normalized(beat.summary) === normalized(submission.summary) &&
      sameIds(beat.dependsOnBeatIds, submission.dependencyIds)
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

export function createStoryIntentEditState(
  sceneId: SceneId,
  projectVersion: number,
  canonical: StoryContextSceneIntent
): StoryIntentEditState {
  const value = intentValue(canonical);
  return Object.freeze({
    sceneId,
    projectVersion,
    base: value,
    draft: value,
    status: "ready"
  });
}

export function storyIntentPatch(
  base: StoryIntentDraft,
  draft: StoryIntentDraft
): SceneIntentPatch {
  const patch: {
    purpose?: string | null;
    conflict?: string | null;
    turn?: string | null;
    openQuestions?: string | null;
  } = {};
  for (const field of [
    "purpose",
    "conflict",
    "turn",
    "openQuestions"
  ] as const) {
    const before = normalized(base[field]);
    const after = normalized(draft[field]);
    if (before !== after) patch[field] = after.length === 0 ? null : after;
  }
  return Object.freeze(patch);
}

export function storyIntentHasChanges(state: StoryIntentEditState): boolean {
  return Object.keys(storyIntentPatch(state.base, state.draft)).length > 0;
}

export function editStoryIntent(
  state: StoryIntentEditState,
  field: keyof StoryIntentDraft,
  value: string
): StoryIntentEditState {
  return Object.freeze({
    ...state,
    draft: Object.freeze({ ...state.draft, [field]: value }),
    status: state.status === "canonical-changed" ? state.status : "editing"
  });
}

export function reconcileStoryIntent(
  state: StoryIntentEditState,
  sceneId: SceneId,
  projectVersion: number,
  canonical: StoryContextSceneIntent
): StoryIntentEditState {
  const value = intentValue(canonical);
  if (state.sceneId !== sceneId) {
    if (!storyIntentHasChanges(state) && state.status !== "not-saved") {
      return createStoryIntentEditState(sceneId, projectVersion, canonical);
    }
    return Object.freeze({
      ...state,
      status: "canonical-changed",
      incoming: Object.freeze({ sceneId, projectVersion, value })
    });
  }
  if (state.projectVersion === projectVersion) return state;
  if (state.submitted !== undefined && sameIntent(state.submitted, value)) {
    return Object.freeze({
      ...state,
      projectVersion,
      base: value,
      draft: state.draft,
      status: "saving",
      incoming: undefined,
      submitted: state.submitted
    });
  }
  if (!storyIntentHasChanges(state) && state.status !== "not-saved") {
    return createStoryIntentEditState(sceneId, projectVersion, canonical);
  }
  return Object.freeze({
    ...state,
    status: "canonical-changed",
    incoming: Object.freeze({ sceneId, projectVersion, value })
  });
}

export function useLatestStoryIntent(
  state: StoryIntentEditState
): StoryIntentEditState {
  return state.incoming === undefined
    ? state
    : createStoryIntentEditState(
        state.incoming.sceneId,
        state.incoming.projectVersion,
        state.incoming.value
      );
}

export function continueStoryIntentDraft(
  state: StoryIntentEditState
): StoryIntentEditState {
  if (state.incoming === undefined) return state;
  if (state.incoming.sceneId !== state.sceneId) return state;
  return Object.freeze({
    sceneId: state.sceneId,
    projectVersion: state.incoming.projectVersion,
    base: state.incoming.value,
    draft: state.draft,
    status: "editing"
  });
}

export function storyIntentSaving(
  state: StoryIntentEditState
): StoryIntentEditState {
  return Object.freeze({ ...state, status: "saving", submitted: state.draft });
}

export function storyIntentSaveResult(
  state: StoryIntentEditState,
  saved: boolean
): StoryIntentEditState {
  if (state.status === "canonical-changed") {
    return Object.freeze({ ...state, submitted: undefined });
  }
  if (!saved) {
    return Object.freeze({ ...state, status: "not-saved", submitted: undefined });
  }
  const submitted = state.submitted ?? state.draft;
  const hasLaterEdits = !sameIntent(state.draft, submitted);
  const acknowledgedBase = sameIntent(state.base, submitted) ? state.base : submitted;
  return Object.freeze({
    ...state,
    base: acknowledgedBase,
    status: hasLaterEdits ? "editing" : "saved",
    incoming: undefined,
    submitted: undefined
  });
}

export function createStoryTextEditState(
  identity: string,
  projectVersion: number,
  canonical: string | undefined
): StoryTextEditState {
  const value = canonical ?? "";
  return Object.freeze({
    identity,
    projectVersion,
    base: value,
    draft: value,
    status: "ready"
  });
}

export function editStoryText(
  state: StoryTextEditState,
  value: string
): StoryTextEditState {
  return Object.freeze({
    ...state,
    draft: value,
    status: state.status === "canonical-changed" ? state.status : "editing"
  });
}

export function reconcileStoryText(
  state: StoryTextEditState,
  identity: string,
  projectVersion: number,
  canonical: string | undefined
): StoryTextEditState {
  const value = canonical ?? "";
  if (state.identity !== identity) {
    if (normalized(state.base) === normalized(state.draft) && state.status !== "not-saved") {
      return createStoryTextEditState(identity, projectVersion, canonical);
    }
    return Object.freeze({
      ...state,
      status: "canonical-changed",
      incoming: Object.freeze({ identity, projectVersion, value })
    });
  }
  if (state.projectVersion === projectVersion) return state;
  if (state.submitted !== undefined && normalized(state.submitted) === normalized(value)) {
    return Object.freeze({
      ...state,
      projectVersion,
      base: value,
      draft: state.draft,
      status: "saving",
      incoming: undefined,
      submitted: state.submitted
    });
  }
  if (normalized(state.base) === normalized(state.draft) && state.status !== "not-saved") {
    return createStoryTextEditState(identity, projectVersion, value);
  }
  return Object.freeze({
    ...state,
    status: "canonical-changed",
    incoming: Object.freeze({ identity, projectVersion, value })
  });
}

export function useLatestStoryText(state: StoryTextEditState): StoryTextEditState {
  return state.incoming === undefined
    ? state
    : createStoryTextEditState(
        state.incoming.identity,
        state.incoming.projectVersion,
        state.incoming.value
      );
}

export function continueStoryTextDraft(
  state: StoryTextEditState
): StoryTextEditState {
  if (state.incoming === undefined) return state;
  if (state.incoming.identity !== state.identity) return state;
  return Object.freeze({
    identity: state.identity,
    projectVersion: state.incoming.projectVersion,
    base: state.incoming.value,
    draft: state.draft,
    status: "editing"
  });
}

export function storyTextSaveResult(
  state: StoryTextEditState,
  saved: boolean
): StoryTextEditState {
  if (state.status === "canonical-changed") {
    return Object.freeze({ ...state, submitted: undefined });
  }
  if (!saved) {
    return Object.freeze({ ...state, status: "not-saved", submitted: undefined });
  }
  const submitted = state.submitted ?? state.draft;
  const hasLaterEdits = normalized(state.draft) !== normalized(submitted);
  const acknowledgedBase = normalized(state.base) === normalized(submitted)
    ? state.base
    : submitted;
  return Object.freeze({
    ...state,
    base: acknowledgedBase,
    status: hasLaterEdits ? "editing" : "saved",
    incoming: undefined,
    submitted: undefined
  });
}

export function storyTextSaving(state: StoryTextEditState): StoryTextEditState {
  return Object.freeze({ ...state, status: "saving", submitted: state.draft });
}

export function storyContextThreadChoices(
  project: ProjectNavigator,
  context: StoryContextProjection,
  limit = STORY_CONTEXT_THREAD_CHOICE_LIMIT,
  query = ""
): readonly StoryThreadChoice[] {
  const relevantIds = new Set(context.threads.map((thread) => thread.id));
  return Object.freeze(
    project.storyKnowledge
      .filter(
        (knowledge) =>
          knowledge.kind === "thread" &&
          (knowledge.archivedAt === undefined || relevantIds.has(knowledge.id)) &&
          knowledge.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      )
      .sort((left, right) => {
        const relevance = Number(relevantIds.has(right.id)) - Number(relevantIds.has(left.id));
        return relevance || left.label.localeCompare(right.label);
      })
      .slice(0, Math.max(0, limit))
      .map((knowledge) =>
        Object.freeze({
          id: knowledge.id,
          label: knowledge.label,
          relevant: relevantIds.has(knowledge.id),
          archived: knowledge.archivedAt !== undefined
        })
      )
  );
}

function canonicalSceneIndex(project: ProjectNavigator): ReadonlyMap<SceneId, number> {
  const ids = project.books.flatMap((book) => [
    ...book.parts.flatMap((part) =>
      part.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.id))
    ),
    ...book.unassignedScenes.map((scene) => scene.id)
  ]);
  return new Map(ids.map((id, index) => [id, index]));
}

function sceneDetails(
  project: ProjectNavigator
): ReadonlyMap<SceneId, Readonly<{ title: string; archived: boolean }>> {
  return new Map(
    project.books.flatMap((book) => [
      ...book.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) =>
          chapter.scenes.map((scene) => [
            scene.id,
            { title: scene.title, archived: scene.archivedAt !== undefined }
          ] as const)
        )
      ),
      ...book.unassignedScenes.map((scene) => [
        scene.id,
        { title: scene.title, archived: scene.archivedAt !== undefined }
      ] as const)
    ])
  );
}

export function narrativeDependencyChoices(
  project: ProjectNavigator,
  thread: ProjectNavigatorKnowledge,
  options: Readonly<{
    excludeBeatId?: NarrativeBeatId;
    includeBeatIds?: readonly NarrativeBeatId[];
    limit?: number;
  }> = {}
): readonly NarrativeDependencyChoice[] {
  const sceneIndex = canonicalSceneIndex(project);
  const scenes = sceneDetails(project);
  const included = new Set(options.includeBeatIds ?? []);
  const eligible = [...(thread.narrative?.beats ?? [])]
    .filter(
      (beat) =>
        beat.id !== options.excludeBeatId &&
        (beat.archivedAt === undefined || included.has(beat.id))
    )
    .sort(
      (left, right) =>
        (sceneIndex.get(left.sceneId) ?? Number.MAX_SAFE_INTEGER) -
          (sceneIndex.get(right.sceneId) ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id)
    );
  const limit = Math.max(0, options.limit ?? STORY_CONTEXT_DEPENDENCY_CHOICE_LIMIT);
  const bounded = eligible.slice(0, limit);
  for (const beat of eligible) {
    if (included.has(beat.id) && !bounded.some((entry) => entry.id === beat.id)) {
      bounded.push(beat);
    }
  }
  return Object.freeze(
    bounded.map((beat) => {
      const scene = scenes.get(beat.sceneId);
      return Object.freeze({
        id: beat.id,
        label: `${beat.role} · ${scene?.title ?? beat.sceneId} · ${beat.summary}`,
        archived: beat.archivedAt !== undefined,
        sceneArchived: scene?.archived ?? false
      });
    })
  );
}

export function narrativeAnchorLabel(beat: StoryContextBeatProjection): string {
  switch (beat.anchorState) {
    case "active":
      return "Active anchor";
    case "beat-archived":
      return "Archived beat";
    case "scene-archived":
      return "Archived scene anchor";
    case "beat-and-scene-archived":
      return "Archived beat · archived scene anchor";
  }
}

export function threadSceneSemantics(input: Readonly<{
  associated: boolean;
  mappedBeatCount: number;
}>): readonly string[] {
  return Object.freeze([
    ...(input.associated ? ["Story-record association"] : []),
    ...(input.mappedBeatCount > 0 ? ["Explicit narrative beat"] : [])
  ]);
}
