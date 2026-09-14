import type { CanvasObject, CanvasObjectId, SceneId } from "@ghostwriter/core";

export type CanvasInspection = Readonly<{
  inspectedSceneId?: SceneId;
  selectedObjectId?: CanvasObjectId;
}>;

type InspectableCanvasObject = Pick<
  CanvasObject,
  "archivedAt" | "dismissedAt" | "id" | "sceneId"
>;

export function canvasInspectionForScene(
  objects: readonly InspectableCanvasObject[],
  sceneId: SceneId
): CanvasInspection {
  const sceneObject = objects.find(
    (object) =>
      object.sceneId === sceneId &&
      object.archivedAt === undefined &&
      object.dismissedAt === undefined
  );
  return {
    inspectedSceneId: sceneId,
    ...(sceneObject === undefined ? {} : { selectedObjectId: sceneObject.id })
  };
}

export function canvasInspectionForObject(
  objects: readonly InspectableCanvasObject[],
  objectId: CanvasObjectId | undefined
): CanvasInspection {
  if (objectId === undefined) return {};
  const object = objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) return {};
  return {
    selectedObjectId: object.id,
    ...(object.sceneId === undefined ? {} : { inspectedSceneId: object.sceneId })
  };
}
