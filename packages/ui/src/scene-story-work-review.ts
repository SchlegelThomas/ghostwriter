import {
  validateSceneDraftV1,
  type SceneDraftV1,
  type SceneId,
  type StoryWorkArtifactPointer
} from "@ghostwriter/core";

export type SceneReviewArtifact = Readonly<{
  pointer: StoryWorkArtifactPointer;
  payload: SceneDraftV1;
}>;

export type SceneReviewSource = Readonly<{
  sceneId: SceneId;
  title: string;
}>;

export type SceneReviewSourceCoverage = Readonly<{
  sceneId: SceneId;
  title: string;
  available: boolean;
}>;

export const SCENE_REVIEW_REVISION_INSTRUCTION_MAX_CHARS = 20_000;

export type SceneStoryWorkRevisionPrefill = Readonly<{
  requestToken: string;
  instruction: string;
}>;

export function shouldApplySceneReviewRevisionPrefill(
  appliedToken: string | undefined,
  nextToken: string | undefined
): nextToken is string {
  const normalized = nextToken?.trim();
  return (
    normalized !== undefined &&
    normalized.length > 0 &&
    normalized !== appliedToken
  );
}

export type SceneReviewRevisionPrefillDecision = Readonly<
  | { action: "install"; instruction: string }
  | { action: "refuse"; reason: string }
>;

/** Installs bounded revision text only when the writer has not already entered a request. */
export function applySceneReviewRevisionPrefill(input: Readonly<{
  instruction: string;
  currentInstruction: string;
  maxChars?: number;
}>): SceneReviewRevisionPrefillDecision {
  const maxChars = input.maxChars ?? SCENE_REVIEW_REVISION_INSTRUCTION_MAX_CHARS;
  const trimmed = input.instruction.trim();
  if (trimmed.length === 0) {
    return Object.freeze({
      action: "refuse",
      reason: "The revision suggestion was empty and was not installed."
    });
  }
  if (trimmed.length > maxChars) {
    return Object.freeze({
      action: "refuse",
      reason: `Revision suggestions are limited to ${maxChars} characters.`
    });
  }
  if (input.currentInstruction.trim().length > 0) {
    return Object.freeze({
      action: "refuse",
      reason:
        "You already started a revision request. Clear it before loading another suggestion."
    });
  }
  return Object.freeze({ action: "install", instruction: trimmed });
}

/** Review editing changes literal prose only; source selection remains immutable. */
export function sceneReviewPayload(
  prose: string,
  original: SceneDraftV1
): SceneDraftV1 {
  return validateSceneDraftV1({
    schemaId: "scene-draft-v1",
    prose,
    sourceSceneIds: original.sourceSceneIds
  });
}

export function sceneReviewHasEdits(
  prose: string,
  original: SceneDraftV1
): boolean {
  return prose !== original.prose;
}

export function sameSceneReviewArtifact(
  left: StoryWorkArtifactPointer,
  right: StoryWorkArtifactPointer
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.artifactVersion === right.artifactVersion &&
    left.contentHash === right.contentHash
  );
}

export function sceneReviewSourceCoverage(
  payload: SceneDraftV1,
  supplied: readonly SceneReviewSource[]
): readonly SceneReviewSourceCoverage[] {
  const byId = new Map(supplied.map((source) => [source.sceneId, source.title]));
  return Object.freeze(
    payload.sourceSceneIds.map((sceneId) => {
      const title = byId.get(sceneId);
      return Object.freeze({
        sceneId,
        title: title ?? String(sceneId),
        available: title !== undefined
      });
    })
  );
}
