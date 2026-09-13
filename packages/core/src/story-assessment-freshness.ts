import { canonicalJsonStringify } from "./agent-canonical-json.js";
import type { AsyncHashPort } from "./agent-domain.js";
import { DomainValidationError, type ChapterId, type ManuscriptChapter, type Scene, type SceneId, type StoryKnowledge, type StoryKnowledgeId } from "./domain.js";
import type { StoryContextProjection, StoryContextScope } from "./story-context.js";

export const STORY_ASSESSMENT_MAX_DEPENDENCIES = 2_000;

export type StoryAssessmentDependency =
  | Readonly<{
      kind: "scene-prose";
      sceneId: SceneId;
      workingVersion: number;
      contentHash: string;
    }>
  | Readonly<{
      kind: "scene-intent";
      sceneId: SceneId;
      revisionToken: string;
    }>
  | Readonly<{
      kind: "chapter-objective";
      chapterId: ChapterId;
      revisionToken: string;
    }>
  | Readonly<{
      kind: "story-knowledge";
      storyKnowledgeId: StoryKnowledgeId;
      revisionToken: string;
    }>
  | Readonly<{
      kind: "manuscript-slice";
      scope: StoryContextScope;
      revisionToken: string;
    }>;

export type StoryAssessmentRevisionVector = Readonly<{
  dependencies: readonly StoryAssessmentDependency[];
}>;

export type StoryAssessmentFreshnessReason =
  | "scene-prose-changed"
  | "scene-intent-changed"
  | "chapter-objective-changed"
  | "story-knowledge-changed"
  | "manuscript-slice-changed"
  | "dependency-missing";

export type StoryAssessmentFreshness =
  | Readonly<{ status: "fresh" }>
  | Readonly<{
      status: "needs-recheck";
      reasons: readonly Readonly<{
        dependencyKey: string;
        reason: StoryAssessmentFreshnessReason;
      }>[];
    }>;

function requireToken(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${label} must not be empty.`);
  }
  if (normalized.length > 100_000) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `${label} is too large for an assessment dependency.`
    );
  }
  return normalized;
}

function scopeKey(scope: StoryContextScope): string {
  switch (scope.kind) {
    case "project":
      return "project";
    case "chapter":
      return `chapter:${scope.chapterId}`;
    case "scene":
      return `scene:${scope.sceneId}`;
  }
}

export function storyAssessmentDependencyKey(
  dependency: StoryAssessmentDependency
): string {
  switch (dependency.kind) {
    case "scene-prose":
    case "scene-intent":
      return `${dependency.kind}:${dependency.sceneId}`;
    case "chapter-objective":
      return `${dependency.kind}:${dependency.chapterId}`;
    case "story-knowledge":
      return `${dependency.kind}:${dependency.storyKnowledgeId}`;
    case "manuscript-slice":
      return `${dependency.kind}:${scopeKey(dependency.scope)}`;
  }
}

export function createStoryAssessmentRevisionVector(
  dependencies: readonly StoryAssessmentDependency[]
): StoryAssessmentRevisionVector {
  if (dependencies.length > STORY_ASSESSMENT_MAX_DEPENDENCIES) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Story assessments are limited to ${STORY_ASSESSMENT_MAX_DEPENDENCIES} dependencies.`
    );
  }
  const keys = new Set<string>();
  const normalized = dependencies.map((dependency) => {
    const key = storyAssessmentDependencyKey(dependency);
    if (keys.has(key)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `Story assessment contains duplicate dependency "${key}".`
      );
    }
    keys.add(key);
    if (dependency.kind === "scene-prose") {
      if (!Number.isSafeInteger(dependency.workingVersion) || dependency.workingVersion < 1) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Scene prose working version must be a positive integer."
        );
      }
      return Object.freeze({
        ...dependency,
        contentHash: requireToken(dependency.contentHash, "Scene prose content hash")
      });
    }
    return Object.freeze({
      ...dependency,
      revisionToken: requireToken(dependency.revisionToken, "Revision token")
    });
  });
  return Object.freeze({ dependencies: Object.freeze(normalized) });
}

function changedReason(
  dependency: StoryAssessmentDependency
): Exclude<StoryAssessmentFreshnessReason, "dependency-missing"> {
  switch (dependency.kind) {
    case "scene-prose":
      return "scene-prose-changed";
    case "scene-intent":
      return "scene-intent-changed";
    case "chapter-objective":
      return "chapter-objective-changed";
    case "story-knowledge":
      return "story-knowledge-changed";
    case "manuscript-slice":
      return "manuscript-slice-changed";
  }
}

function dependencyMatches(
  expected: StoryAssessmentDependency,
  current: StoryAssessmentDependency
): boolean {
  if (expected.kind !== current.kind) return false;
  if (expected.kind === "scene-prose" && current.kind === "scene-prose") {
    return (
      expected.workingVersion === current.workingVersion &&
      expected.contentHash === current.contentHash
    );
  }
  if (expected.kind === "scene-intent" && current.kind === "scene-intent") {
    return expected.revisionToken === current.revisionToken;
  }
  if (expected.kind === "chapter-objective" && current.kind === "chapter-objective") {
    return expected.revisionToken === current.revisionToken;
  }
  if (
    expected.kind === "story-knowledge" &&
    current.kind === "story-knowledge"
  ) {
    return expected.revisionToken === current.revisionToken;
  }
  return (
    expected.kind === "manuscript-slice" &&
    current.kind === "manuscript-slice" &&
    expected.revisionToken === current.revisionToken
  );
}

/**
 * Compares only resources the assessment actually consumed. Additional live
 * resources and unrelated project metadata do not make an assessment stale.
 */
export function evaluateStoryAssessmentFreshness(
  assessed: StoryAssessmentRevisionVector,
  current: StoryAssessmentRevisionVector
): StoryAssessmentFreshness {
  const expected = createStoryAssessmentRevisionVector(assessed.dependencies);
  const live = createStoryAssessmentRevisionVector(current.dependencies);
  const liveByKey = new Map(
    live.dependencies.map((dependency) => [
      storyAssessmentDependencyKey(dependency),
      dependency
    ])
  );
  const reasons: Array<
    Readonly<{
      dependencyKey: string;
      reason: StoryAssessmentFreshnessReason;
    }>
  > = [];
  for (const dependency of expected.dependencies) {
    const dependencyKey = storyAssessmentDependencyKey(dependency);
    const currentDependency = liveByKey.get(dependencyKey);
    if (currentDependency === undefined) {
      reasons.push(Object.freeze({ dependencyKey, reason: "dependency-missing" }));
      continue;
    }
    if (!dependencyMatches(dependency, currentDependency)) {
      reasons.push(
        Object.freeze({ dependencyKey, reason: changedReason(dependency) })
      );
    }
  }
  return reasons.length === 0
    ? Object.freeze({ status: "fresh" })
    : Object.freeze({ status: "needs-recheck", reasons: Object.freeze(reasons) });
}

/** Digest of the exact existing scene metadata that expresses intent. */
export async function storySceneIntentRevisionToken(
  scene: Pick<Scene, "id" | "summary" | "sketch">,
  hashPort: AsyncHashPort
): Promise<string> {
  return hashPort.digestSha256Hex(
    canonicalJsonStringify({
      sceneId: scene.id,
      summary: scene.summary,
      sketch: scene.sketch
    })
  );
}

/** Digest of the exact story-knowledge record consumed by an assessment. */
export async function storyKnowledgeRevisionToken(
  knowledge: StoryKnowledge,
  hashPort: AsyncHashPort
): Promise<string> {
  return hashPort.digestSha256Hex(canonicalJsonStringify(knowledge));
}

/**
 * Canonical structure digest. It includes order, placement, and archive flags,
 * but excludes titles, objectives, intent, and all Canvas state.
 */
export async function storyManuscriptSliceRevisionToken(
  context: StoryContextProjection,
  hashPort: AsyncHashPort
): Promise<string> {
  return hashPort.digestSha256Hex(
    canonicalJsonStringify({
      projectId: context.projectId,
      scope: context.scope,
      scenes: context.scenes.map((scene) => ({
        sceneId: scene.id,
        bookId: scene.book.id,
        partId: scene.part?.id,
        chapterId: scene.chapter?.id,
        placement: scene.placement,
        canonicalIndex: scene.canonicalIndex,
        archival: scene.archival
      }))
    })
  );
}

/** Objectives have their own dependency; unrelated chapter titles do not invalidate it. */
export async function storyChapterObjectiveRevisionToken(
  chapter: Pick<ManuscriptChapter, "id" | "summary">,
  hashPort: AsyncHashPort
): Promise<string> {
  return hashPort.digestSha256Hex(canonicalJsonStringify({
    chapterId: chapter.id, objective: chapter.summary
  }));
}
