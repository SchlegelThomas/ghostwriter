import {
  DomainValidationError,
  type BookId,
  type ChapterId,
  type NarrativeBeatId,
  type NarrativeBeatRole,
  type NarrativeThreadResolution,
  type PartId,
  type ProjectId,
  type ProjectRecords,
  type SceneId,
  type SceneSketch,
  type SceneStatus,
  type StoryKnowledgeAuthority,
  type StoryKnowledgeId,
  type StoryThreadNarrative
} from "./domain.js";
import type { ProjectNavigator } from "./project-navigator.js";

export const STORY_CONTEXT_MAX_SCENES = 500;

export type StoryContextScope =
  | Readonly<{ kind: "project" }>
  | Readonly<{ kind: "chapter"; chapterId: ChapterId }>
  | Readonly<{ kind: "scene"; sceneId: SceneId }>;

export type StoryContextArchivalState = Readonly<{
  projectArchived: boolean;
  bookArchived: boolean;
  sceneArchived: boolean;
}>;

export type StoryContextSceneIntent = Readonly<{
  purpose?: string;
  conflict?: string;
  turn?: string;
  openQuestions?: string;
}>;

export type StoryContextAdjacentScene = Readonly<{
  id: SceneId;
  title: string;
  canonicalIndex: number;
  archival: StoryContextArchivalState;
}>;

export type StoryContextBeatProjection = Readonly<{
  id: NarrativeBeatId;
  threadId: StoryKnowledgeId;
  sceneId: SceneId;
  role: NarrativeBeatRole;
  summary: string;
  dependsOnBeatIds: readonly NarrativeBeatId[];
  archived: boolean;
  canonicalIndex: number;
  sceneTitle: string;
  sceneArchived: boolean;
  anchorState:
    | "active"
    | "beat-archived"
    | "scene-archived"
    | "beat-and-scene-archived";
}>;

export type StoryContextSceneProjection = Readonly<{
  id: SceneId;
  title: string;
  status: SceneStatus;
  summary?: string;
  book: Readonly<{ id: BookId; title: string }>;
  part?: Readonly<{ id: PartId; title: string }>;
  chapter?: Readonly<{ id: ChapterId; title: string; objective?: string }>;
  placement: "chapter" | "unassigned";
  canonicalIndex: number;
  archival: StoryContextArchivalState;
  intent: StoryContextSceneIntent;
  previousScene?: StoryContextAdjacentScene;
  nextScene?: StoryContextAdjacentScene;
  /** Existing scene-to-thread membership. This is not a causal mapping. */
  threadAssociationIds: readonly StoryKnowledgeId[];
  /** Explicit authored narrative beats only; associations never imply roles. */
  narrativeBeats: readonly StoryContextBeatProjection[];
}>;

export type StoryContextThreadProjection = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  authority: StoryKnowledgeAuthority;
  archived: boolean;
  narrativeState: "unmapped" | NarrativeThreadResolution;
  /** Existing StoryKnowledge.linkedSceneIds in this scope, ordered by the manuscript. */
  associatedSceneIds: readonly SceneId[];
  /**
   * Explicit beat records in this scope only; association never implies a beat role.
   * Dependency IDs may point outside a narrow projection. Callers must resolve those
   * anchors through another bounded query instead of expanding the scope implicitly.
   */
  narrativeBeats: readonly StoryContextBeatProjection[];
}>;

export type StoryContextProjection = Readonly<{
  projectId: ProjectId;
  projectVersion: number;
  scope: StoryContextScope;
  totalCanonicalSceneCount: number;
  scenes: readonly StoryContextSceneProjection[];
  threads: readonly StoryContextThreadProjection[];
}>;

type NormalizedScene = Readonly<{
  id: SceneId;
  title: string;
  status: SceneStatus;
  summary?: string;
  sketch?: SceneSketch;
  archivedAt?: string;
  bookId: BookId;
  bookTitle: string;
  bookArchivedAt?: string;
  partId?: PartId;
  partTitle?: string;
  chapterId?: ChapterId;
  chapterTitle?: string;
  chapterObjective?: string;
  placement: "chapter" | "unassigned";
}>;

type NormalizedThread = Readonly<{
  id: StoryKnowledgeId;
  label: string;
  authority: StoryKnowledgeAuthority;
  linkedSceneIds: readonly SceneId[];
  narrative?: StoryThreadNarrative;
  archivedAt?: string;
}>;

type NormalizedProject = Readonly<{
  id: ProjectId;
  version: number;
  archivedAt?: string;
  chapterIds: readonly ChapterId[];
  scenes: readonly NormalizedScene[];
  threads: readonly NormalizedThread[];
}>;

export type StoryContextOptions = Readonly<{
  scope?: StoryContextScope;
}>;

function normalizeRecords(records: ProjectRecords): NormalizedProject {
  const sceneById = new Map(records.scenes.map((scene) => [scene.id, scene]));
  const scenes: NormalizedScene[] = [];
  for (const bookId of records.project.bookIds) {
    const book = records.books.find((candidate) => candidate.id === bookId);
    if (book === undefined) continue;
    for (const part of book.manuscript.parts) {
      for (const chapter of part.chapters) {
        for (const orderedSceneId of chapter.sceneIds) {
          const scene = sceneById.get(orderedSceneId);
          if (scene === undefined) continue;
          scenes.push({
            id: scene.id,
            title: scene.title,
            status: scene.status,
            ...(scene.summary === undefined ? {} : { summary: scene.summary }),
            ...(scene.sketch === undefined ? {} : { sketch: scene.sketch }),
            ...(scene.archivedAt === undefined ? {} : { archivedAt: scene.archivedAt }),
            bookId: book.id,
            bookTitle: book.title,
            ...(book.archivedAt === undefined ? {} : { bookArchivedAt: book.archivedAt }),
            partId: part.id,
            partTitle: part.title,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            ...(chapter.summary === undefined
              ? {}
              : { chapterObjective: chapter.summary }),
            placement: "chapter"
          });
        }
      }
    }
    for (const orderedSceneId of book.manuscript.unassignedSceneIds) {
      const scene = sceneById.get(orderedSceneId);
      if (scene === undefined) continue;
      scenes.push({
        id: scene.id,
        title: scene.title,
        status: scene.status,
        ...(scene.summary === undefined ? {} : { summary: scene.summary }),
        ...(scene.sketch === undefined ? {} : { sketch: scene.sketch }),
        ...(scene.archivedAt === undefined ? {} : { archivedAt: scene.archivedAt }),
        bookId: book.id,
        bookTitle: book.title,
        ...(book.archivedAt === undefined ? {} : { bookArchivedAt: book.archivedAt }),
        placement: "unassigned"
      });
    }
  }
  return {
    id: records.project.id,
    version: records.project.version,
    ...(records.project.archivedAt === undefined
      ? {}
      : { archivedAt: records.project.archivedAt }),
    chapterIds: records.books.flatMap((book) =>
      book.manuscript.parts.flatMap((part) =>
        part.chapters.map((chapter) => chapter.id)
      )
    ),
    scenes,
    threads: records.storyKnowledge
      .filter((knowledge) => knowledge.kind === "thread")
      .map((knowledge) => ({
        id: knowledge.id,
        label: knowledge.label,
        authority: knowledge.authority,
        linkedSceneIds: knowledge.linkedSceneIds,
        ...(knowledge.narrative === undefined
          ? {}
          : { narrative: knowledge.narrative }),
        ...(knowledge.archivedAt === undefined
          ? {}
          : { archivedAt: knowledge.archivedAt })
      }))
  };
}

function normalizeNavigator(project: ProjectNavigator): NormalizedProject {
  const scenes: NormalizedScene[] = [];
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        for (const scene of chapter.scenes) {
          scenes.push({
            id: scene.id,
            title: scene.title,
            status: scene.status,
            ...(scene.summary === undefined ? {} : { summary: scene.summary }),
            ...(scene.sketch === undefined ? {} : { sketch: scene.sketch }),
            ...(scene.archivedAt === undefined ? {} : { archivedAt: scene.archivedAt }),
            bookId: book.id,
            bookTitle: book.title,
            ...(book.archivedAt === undefined ? {} : { bookArchivedAt: book.archivedAt }),
            partId: part.id,
            partTitle: part.title,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            ...(chapter.summary === undefined
              ? {}
              : { chapterObjective: chapter.summary }),
            placement: "chapter"
          });
        }
      }
    }
    for (const scene of book.unassignedScenes) {
      scenes.push({
        id: scene.id,
        title: scene.title,
        status: scene.status,
        ...(scene.summary === undefined ? {} : { summary: scene.summary }),
        ...(scene.sketch === undefined ? {} : { sketch: scene.sketch }),
        ...(scene.archivedAt === undefined ? {} : { archivedAt: scene.archivedAt }),
        bookId: book.id,
        bookTitle: book.title,
        ...(book.archivedAt === undefined ? {} : { bookArchivedAt: book.archivedAt }),
        placement: "unassigned"
      });
    }
  }
  return {
    id: project.id,
    version: project.version,
    ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt }),
    chapterIds: project.books.flatMap((book) =>
      book.parts.flatMap((part) => part.chapters.map((chapter) => chapter.id))
    ),
    scenes,
    threads: project.storyKnowledge
      .filter((knowledge) => knowledge.kind === "thread")
      .map((knowledge) => ({
        id: knowledge.id,
        label: knowledge.label,
        authority: knowledge.authority,
        linkedSceneIds: knowledge.linkedSceneIds,
        ...(knowledge.narrative === undefined
          ? {}
          : { narrative: knowledge.narrative }),
        ...(knowledge.archivedAt === undefined
          ? {}
          : { archivedAt: knowledge.archivedAt })
      }))
  };
}

function sceneIntent(sketch: SceneSketch | undefined): StoryContextSceneIntent {
  return Object.freeze({
    ...(sketch?.purpose === undefined ? {} : { purpose: sketch.purpose }),
    ...(sketch?.conflict === undefined ? {} : { conflict: sketch.conflict }),
    ...(sketch?.turn === undefined ? {} : { turn: sketch.turn }),
    ...(sketch?.openQuestions === undefined
      ? {}
      : { openQuestions: sketch.openQuestions })
  });
}

function archivalState(
  project: NormalizedProject,
  scene: NormalizedScene
): StoryContextArchivalState {
  return Object.freeze({
    projectArchived: project.archivedAt !== undefined,
    bookArchived: scene.bookArchivedAt !== undefined,
    sceneArchived: scene.archivedAt !== undefined
  });
}

function validateScope(project: NormalizedProject, scope: StoryContextScope): void {
  if (scope.kind === "scene") {
    if (!project.scenes.some((scene) => scene.id === scope.sceneId)) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        `Story context cannot resolve scene "${scope.sceneId}".`
      );
    }
    return;
  }
  if (
    scope.kind === "chapter" &&
    !project.chapterIds.includes(scope.chapterId)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      `Story context cannot resolve chapter "${scope.chapterId}".`
    );
  }
}

function projectContext(
  project: NormalizedProject,
  options: StoryContextOptions
): StoryContextProjection {
  const scope = options.scope ?? ({ kind: "project" } as const);
  validateScope(project, scope);
  const sceneIndexById = new Map(
    project.scenes.map((scene, canonicalIndex) => [scene.id, canonicalIndex])
  );
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  const beatProjections = project.threads
    .flatMap((thread) =>
      (thread.narrative?.beats ?? []).map((beat) => ({ threadId: thread.id, beat }))
    )
    .map(({ threadId, beat }): StoryContextBeatProjection => {
      const scene = sceneById.get(beat.sceneId);
      const canonicalIndex = sceneIndexById.get(beat.sceneId);
      if (scene === undefined || canonicalIndex === undefined) {
        throw new DomainValidationError(
          "UNKNOWN_REFERENCE",
          `Narrative beat "${beat.id}" has an unknown scene anchor.`
        );
      }
      return Object.freeze({
        id: beat.id,
        threadId,
        sceneId: beat.sceneId,
        role: beat.role,
        summary: beat.summary,
        dependsOnBeatIds: Object.freeze([...beat.dependsOnBeatIds]),
        archived: beat.archivedAt !== undefined,
        canonicalIndex,
        sceneTitle: scene.title,
        sceneArchived: scene.archivedAt !== undefined,
        anchorState:
          beat.archivedAt !== undefined && scene.archivedAt !== undefined
            ? "beat-and-scene-archived"
            : beat.archivedAt !== undefined
              ? "beat-archived"
              : scene.archivedAt !== undefined
                ? "scene-archived"
                : "active"
      });
    })
    .sort(
      (left, right) =>
        left.canonicalIndex - right.canonicalIndex || left.id.localeCompare(right.id)
    );
  const threadsByScene = new Map<SceneId, StoryKnowledgeId[]>();
  for (const thread of project.threads) {
    for (const linkedSceneId of thread.linkedSceneIds) {
      if (!sceneById.has(linkedSceneId)) continue;
      const current = threadsByScene.get(linkedSceneId) ?? [];
      current.push(thread.id);
      threadsByScene.set(linkedSceneId, current);
    }
  }
  const inScope = (scene: NormalizedScene): boolean =>
    scope.kind === "project" ||
    (scope.kind === "chapter" && scene.chapterId === scope.chapterId) ||
    (scope.kind === "scene" && scene.id === scope.sceneId);
  const projectedSceneCount = project.scenes.filter(inScope).length;
  if (projectedSceneCount > STORY_CONTEXT_MAX_SCENES) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story context is limited to ${STORY_CONTEXT_MAX_SCENES} scenes in one scope.`
    );
  }
  const scenes = project.scenes.flatMap((scene, canonicalIndex) => {
    if (!inScope(scene)) return [];
    const previous = canonicalIndex > 0 ? project.scenes[canonicalIndex - 1] : undefined;
    const next = project.scenes[canonicalIndex + 1];
    const adjacent = (
      candidate: NormalizedScene | undefined,
      index: number
    ): StoryContextAdjacentScene | undefined =>
      candidate === undefined
        ? undefined
        : Object.freeze({
            id: candidate.id,
            title: candidate.title,
            canonicalIndex: index,
            archival: archivalState(project, candidate)
          });
    const projection: StoryContextSceneProjection = Object.freeze({
      id: scene.id,
      title: scene.title,
      status: scene.status,
      ...(scene.summary === undefined ? {} : { summary: scene.summary }),
      book: Object.freeze({ id: scene.bookId, title: scene.bookTitle }),
      ...(scene.partId === undefined || scene.partTitle === undefined
        ? {}
        : { part: Object.freeze({ id: scene.partId, title: scene.partTitle }) }),
      ...(scene.chapterId === undefined || scene.chapterTitle === undefined
        ? {}
        : {
            chapter: Object.freeze({
              id: scene.chapterId,
              title: scene.chapterTitle,
              ...(scene.chapterObjective === undefined
                ? {}
                : { objective: scene.chapterObjective })
            })
          }),
      placement: scene.placement,
      canonicalIndex,
      archival: archivalState(project, scene),
      intent: sceneIntent(scene.sketch),
      ...(previous === undefined
        ? {}
        : { previousScene: adjacent(previous, canonicalIndex - 1) }),
      ...(next === undefined ? {} : { nextScene: adjacent(next, canonicalIndex + 1) }),
      threadAssociationIds: Object.freeze([...(threadsByScene.get(scene.id) ?? [])]),
      narrativeBeats: Object.freeze(
        beatProjections.filter((beat) => beat.sceneId === scene.id)
      )
    });
    return [projection];
  });
  const scopedSceneIds = new Set(scenes.map((scene) => scene.id));
  const relevantThreadIds = new Set<StoryKnowledgeId>();
  for (const scene of scenes) {
    for (const threadId of scene.threadAssociationIds) relevantThreadIds.add(threadId);
    for (const beat of scene.narrativeBeats) relevantThreadIds.add(beat.threadId);
  }
  if (scope.kind === "project") {
    for (const thread of project.threads) relevantThreadIds.add(thread.id);
  }
  const threads = project.threads.flatMap((thread) => {
    if (!relevantThreadIds.has(thread.id)) return [];
    const associatedSceneIds = [...thread.linkedSceneIds]
      .filter((sceneId) => scopedSceneIds.has(sceneId))
      .sort(
        (left, right) =>
          (sceneIndexById.get(left) ?? 0) - (sceneIndexById.get(right) ?? 0)
      );
    const narrativeBeats = beatProjections.filter(
      (beat) =>
        beat.threadId === thread.id &&
        (scope.kind === "project" || scopedSceneIds.has(beat.sceneId))
    );
    return [
      Object.freeze({
        id: thread.id,
        label: thread.label,
        authority: thread.authority,
        archived: thread.archivedAt !== undefined,
        narrativeState: thread.narrative?.resolution ?? "unmapped",
        associatedSceneIds: Object.freeze(associatedSceneIds),
        narrativeBeats: Object.freeze(narrativeBeats)
      })
    ];
  });
  return Object.freeze({
    projectId: project.id,
    projectVersion: project.version,
    scope,
    totalCanonicalSceneCount: project.scenes.length,
    scenes: Object.freeze(scenes),
    threads: Object.freeze(threads)
  });
}

export function storyContextFromProjectRecords(
  records: ProjectRecords,
  options: StoryContextOptions = {}
): StoryContextProjection {
  return projectContext(normalizeRecords(records), options);
}

export function storyContextFromProjectNavigator(
  project: ProjectNavigator,
  options: StoryContextOptions = {}
): StoryContextProjection {
  return projectContext(normalizeNavigator(project), options);
}
