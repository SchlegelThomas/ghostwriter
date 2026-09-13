import type { SceneId } from "@ghostwriter/core";

export type StoryWorkRevisePrefillBrief = Readonly<{
  targetSceneId: SceneId;
  brief: string;
  constraints: string;
  doneWhen: string;
  sceneIds: readonly SceneId[];
}>;

export type StoryWorkPanelRevisePrefill = Readonly<{
  requestToken: string;
  revise: StoryWorkRevisePrefillBrief;
  /** When true or omitted, callers may focus the Story work heading after install. */
  focusStoryWork?: boolean;
}>;

export type SanitizedStoryWorkRevisePrefill = Readonly<{
  targetSceneId?: SceneId;
  brief: string;
  constraints: string;
  doneWhen: string;
  sceneIds: readonly SceneId[];
  warnings: readonly string[];
}>;

export function shouldApplyStoryWorkPanelPrefill(
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

/** Keeps only scene IDs present in the active project scene list; never substitutes unrelated IDs. */
export function sanitizeStoryWorkRevisePrefill(
  revise: StoryWorkRevisePrefillBrief,
  activeSceneIds: readonly SceneId[]
): SanitizedStoryWorkRevisePrefill {
  const active = new Set(activeSceneIds);
  const warnings: string[] = [];
  const targetSceneId = active.has(revise.targetSceneId)
    ? revise.targetSceneId
    : undefined;
  if (targetSceneId === undefined) {
    warnings.push(
      "The suggested revision scene is not active in this project. Choose a destination before starting."
    );
  }
  const seen = new Set<SceneId>();
  const sceneIds: SceneId[] = [];
  let droppedSourceCount = 0;
  for (const sceneId of revise.sceneIds) {
    if (!active.has(sceneId)) {
      droppedSourceCount += 1;
      continue;
    }
    if (seen.has(sceneId)) continue;
    seen.add(sceneId);
    sceneIds.push(sceneId);
  }
  if (droppedSourceCount > 0) {
    warnings.push(
      droppedSourceCount === 1
        ? "One suggested source scene could not be selected because it is unavailable."
        : `${droppedSourceCount} suggested source scenes could not be selected because they are unavailable.`
    );
  }
  return Object.freeze({
    targetSceneId,
    brief: revise.brief,
    constraints: revise.constraints,
    doneWhen: revise.doneWhen,
    sceneIds: Object.freeze(sceneIds),
    warnings: Object.freeze(warnings)
  });
}
