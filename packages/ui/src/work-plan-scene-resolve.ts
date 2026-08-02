import type { WorkPlanJobV1, WorkPlanV1 } from "@ghostwriter/core";

export type WorkPlanSceneRef = Readonly<{
  id: string;
  title: string;
}>;

/**
 * Models often emit scene titles in work plans. Prefer real ids; fall back to
 * title match (case-insensitive), then the writer's open scene.
 */
export function resolveWorkPlanSceneId(
  raw: string | undefined,
  scenes: readonly WorkPlanSceneRef[],
  fallbackSceneId?: string
): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    if (scenes.some((scene) => scene.id === trimmed)) return trimmed;
    const lower = trimmed.toLocaleLowerCase();
    const byTitle = scenes.find(
      (scene) => scene.title.trim().toLocaleLowerCase() === lower
    );
    if (byTitle !== undefined) return byTitle.id;
  }
  return fallbackSceneId;
}

export function resolveWorkPlanScenes(
  plan: WorkPlanV1,
  scenes: readonly WorkPlanSceneRef[],
  fallbackSceneId?: string
): WorkPlanV1 {
  const planSceneId = resolveWorkPlanSceneId(
    plan.sceneId,
    scenes,
    fallbackSceneId
  );
  const jobs = plan.jobs.map((job): WorkPlanJobV1 => {
    const sceneId = resolveWorkPlanSceneId(
      job.sceneId ?? plan.sceneId,
      scenes,
      planSceneId ?? fallbackSceneId
    );
    if (sceneId === job.sceneId) return job;
    return Object.freeze({
      ...job,
      ...(sceneId === undefined ? {} : { sceneId })
    });
  });
  return Object.freeze({
    ...plan,
    ...(planSceneId === undefined ? {} : { sceneId: planSceneId }),
    jobs: Object.freeze(jobs)
  });
}
