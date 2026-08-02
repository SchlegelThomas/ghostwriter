import type { WorkPlanJobV1, WorkPlanV1 } from "./work-plan-v1.js";

export type WorkPlanJobClass = "cheap" | "heavy";

export function classifyWorkPlanJob(
  job: WorkPlanJobV1,
  planHasScenePartner: boolean
): WorkPlanJobClass {
  if (job.kind === "open-scene-partner") return "heavy";
  if (job.heavy === true) return "heavy";
  if (
    job.kind === "run-catalog-agent" &&
    job.catalogAgentId === "dialogue-coach" &&
    planHasScenePartner
  ) {
    return "heavy";
  }
  return "cheap";
}

export function planWorkPlanWaves(plan: WorkPlanV1): Readonly<{
  waveA: readonly WorkPlanJobV1[];
  waveB: readonly WorkPlanJobV1[];
}> {
  const planHasScenePartner = plan.jobs.some(
    (job) => job.kind === "open-scene-partner"
  );
  const waveA: WorkPlanJobV1[] = [];
  const heavyJobs: WorkPlanJobV1[] = [];

  for (const job of plan.jobs) {
    if (classifyWorkPlanJob(job, planHasScenePartner) === "cheap") {
      waveA.push(job);
    } else {
      heavyJobs.push(job);
    }
  }

  const scenePartners = heavyJobs.filter((job) => job.kind === "open-scene-partner");
  const otherHeavy = heavyJobs.filter((job) => job.kind !== "open-scene-partner");
  const waveB = [...scenePartners, ...otherHeavy];

  return Object.freeze({
    waveA: Object.freeze(waveA),
    waveB: Object.freeze(waveB)
  });
}
