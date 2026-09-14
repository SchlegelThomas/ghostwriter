import type { StoryWorkAssignment } from "@ghostwriter/core";
import type { ApplySceneStoryWorkRequest } from "./api.js";

export type SceneStoryWorkAppliedMode =
  | "create-scene"
  | "named-variant"
  | "apply-revision";

const SCENE_APPLY_MODES = new Set<SceneStoryWorkAppliedMode>([
  "create-scene",
  "named-variant",
  "apply-revision"
]);

function singleSceneResult(assignment: StoryWorkAssignment) {
  const sceneResults = assignment.results.filter(
    (result): result is Extract<(typeof assignment.results)[number], { kind: "scene" }> =>
      result.kind === "scene"
  );
  if (sceneResults.length !== 1) return undefined;
  return sceneResults[0];
}

/** Durable applied-mode copy when session state was cleared by reopen/reload. */
export function inferSceneStoryWorkAppliedMode(
  assignment: StoryWorkAssignment
): SceneStoryWorkAppliedMode | undefined {
  if (assignment.status !== "applied" || assignment.destination.kind !== "scene") {
    return undefined;
  }
  const sceneResult = singleSceneResult(assignment);
  if (sceneResult === undefined) return undefined;
  if (sceneResult.sceneId !== assignment.destination.sceneId) return undefined;

  if (assignment.destination.operation === "create") {
    if (assignment.taskKind !== "scene") return undefined;
    if (sceneResult.variantId !== undefined) return undefined;
    if (sceneResult.revisionId === undefined) return undefined;
    return "create-scene";
  }

  if (assignment.destination.operation !== "update" || assignment.taskKind !== "revise") {
    return undefined;
  }

  if (sceneResult.variantId !== undefined) {
    if (sceneResult.revisionId === undefined) return undefined;
    return "named-variant";
  }

  if (sceneResult.revisionId === undefined) return undefined;
  return "apply-revision";
}

export function resolveSceneStoryWorkAppliedMode(input: Readonly<{
  assignment: StoryWorkAssignment;
  sessionMode?: SceneStoryWorkAppliedMode;
}>): SceneStoryWorkAppliedMode | undefined {
  if (
    input.sessionMode !== undefined &&
    SCENE_APPLY_MODES.has(input.sessionMode)
  ) {
    return input.sessionMode;
  }
  return inferSceneStoryWorkAppliedMode(input.assignment);
}

export function refuseCreateSceneCanvasWhenRequested(input: Readonly<{
  placeOnCurrentCanvas: boolean;
  prepareCreateCanvasPlacement?: () => Promise<unknown>;
}>): void {
  if (!input.placeOnCurrentCanvas) return;
  if (input.prepareCreateCanvasPlacement === undefined) {
    throw new Error(
      "Canvas placement is unavailable. Turn off Place on current Canvas or open Canvas before creating this scene."
    );
  }
}

export type SceneStoryWorkUpdateApplyOutcome<T> =
  | Readonly<{ kind: "prepare-refused"; error: unknown }>
  | Readonly<{ kind: "dispatch-failed"; error: unknown }>
  | Readonly<{ kind: "success"; result: T }>
  | Readonly<{ kind: "applied-finish-failed"; result: T; finishError: unknown }>;

export type SceneStoryWorkDraftBoundary = Readonly<{
  expectedWorkingVersion: number;
  expectedContentHash: string;
}>;

/** Stable idempotency key for retries of the same semantic scene apply request. */
export function resolveSceneStoryWorkApplyIdempotencyKey(input: Readonly<{
  current?: Readonly<{ fingerprint: string; key: string }>;
  fingerprint: string;
}>): Readonly<{ fingerprint: string; key: string }> {
  if (input.current?.fingerprint === input.fingerprint) {
    return input.current;
  }
  return Object.freeze({
    fingerprint: input.fingerprint,
    key: crypto.randomUUID()
  });
}

export function sceneStoryWorkApplySemanticFingerprint(
  request: Readonly<Record<string, unknown>>
): string {
  return JSON.stringify(request);
}

export function isSceneStoryWorkUpdateApplyMode(
  mode: ApplySceneStoryWorkRequest["mode"]
): mode is "named-variant" | "apply-revision" {
  return mode === "named-variant" || mode === "apply-revision";
}

/**
 * Scene update apply must pause Draft autosave before dispatch and always refresh afterward,
 * including client-visible apply refusals, without remounting Draft.
 */
export async function runSceneStoryWorkUpdateApply<T>(input: Readonly<{
  prepare(): Promise<SceneStoryWorkDraftBoundary>;
  dispatch(boundary: SceneStoryWorkDraftBoundary): Promise<T>;
  finish(): Promise<void>;
}>): Promise<SceneStoryWorkUpdateApplyOutcome<T>> {
  let boundary: SceneStoryWorkDraftBoundary;
  try {
    boundary = await input.prepare();
  } catch (error) {
    return Object.freeze({ kind: "prepare-refused", error });
  }

  let result: T | undefined;
  let dispatchError: unknown;
  try {
    result = await input.dispatch(boundary);
  } catch (error) {
    dispatchError = error;
  }

  let finishError: unknown;
  try {
    await input.finish();
  } catch (error) {
    finishError = error;
  }

  if (dispatchError !== undefined) {
    if (finishError !== undefined) {
      throw dispatchError;
    }
    return Object.freeze({ kind: "dispatch-failed", error: dispatchError });
  }

  if (result === undefined) {
    throw new Error("Scene story-work apply finished without a dispatch result.");
  }

  if (finishError !== undefined) {
    return Object.freeze({
      kind: "applied-finish-failed",
      result,
      finishError
    });
  }

  return Object.freeze({ kind: "success", result });
}
