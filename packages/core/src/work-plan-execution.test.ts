import { describe, expect, it } from "vitest";
import {
  classifyWorkPlanJob,
  planWorkPlanWaves
} from "./work-plan-execution.js";
import type { WorkPlanJobV1, WorkPlanV1 } from "./work-plan-v1.js";
import { validateWorkPlanV1 } from "./work-plan-v1.js";

function job(
  partial: WorkPlanJobV1 & { id: string; kind: WorkPlanJobV1["kind"]; title: string; instruction: string }
): WorkPlanJobV1 {
  return partial;
}

describe("work-plan-execution", () => {
  it("classifies open-scene-partner as heavy", () => {
    const partner = job({
      id: "job-1",
      kind: "open-scene-partner",
      title: "Partner",
      instruction: "Brief."
    });
    expect(classifyWorkPlanJob(partner, false)).toBe("heavy");
  });

  it("classifies dialogue-coach as heavy only when plan has scene partner", () => {
    const coach = job({
      id: "job-2",
      kind: "run-catalog-agent",
      title: "Dialogue Coach",
      instruction: "Review dialogue.",
      catalogAgentId: "dialogue-coach"
    });
    expect(classifyWorkPlanJob(coach, false)).toBe("cheap");
    expect(classifyWorkPlanJob(coach, true)).toBe("heavy");
  });

  it("classifies heavy flag and default cheap jobs", () => {
    const marked = job({
      id: "job-3",
      kind: "run-catalog-agent",
      title: "Midwife",
      instruction: "Brainstorm.",
      catalogAgentId: "idea-midwife",
      heavy: true
    });
    expect(classifyWorkPlanJob(marked, false)).toBe("heavy");

    const castCheck = job({
      id: "job-4",
      kind: "cast-reference-check",
      title: "Cast check",
      instruction: "Verify roster."
    });
    expect(classifyWorkPlanJob(castCheck, true)).toBe("cheap");
  });

  it("splits waves with scene partner before deferred dialogue coach", () => {
    const plan = validateWorkPlanV1({
      schemaId: "work-plan-v1",
      summary: "Four-job bundle.",
      jobs: [
        {
          id: "job-1",
          kind: "cast-reference-check",
          title: "Continuity",
          instruction: "Check names."
        },
        {
          id: "job-2",
          kind: "create-story-knowledge",
          title: "Add Mara",
          instruction: "Capture Mara.",
          proposedName: "Mara",
          storyKnowledgeKind: "character"
        },
        {
          id: "job-3",
          kind: "open-scene-partner",
          title: "Scene Partner",
          instruction: "Explore the confrontation."
        },
        {
          id: "job-4",
          kind: "run-catalog-agent",
          title: "Dialogue Coach",
          instruction: "Polish dialogue.",
          catalogAgentId: "dialogue-coach"
        }
      ]
    });

    const { waveA, waveB } = planWorkPlanWaves(plan);
    expect(waveA.map((item) => item.id)).toEqual(["job-1", "job-2"]);
    expect(waveB.map((item) => item.id)).toEqual(["job-3", "job-4"]);
  });

  it("keeps dialogue coach in wave A when no scene partner", () => {
    const plan: WorkPlanV1 = validateWorkPlanV1({
      schemaId: "work-plan-v1",
      summary: "Coach only.",
      jobs: [
        {
          id: "job-1",
          kind: "run-catalog-agent",
          title: "Dialogue Coach",
          instruction: "Polish dialogue.",
          catalogAgentId: "dialogue-coach"
        }
      ]
    });

    const { waveA, waveB } = planWorkPlanWaves(plan);
    expect(waveA.map((item) => item.id)).toEqual(["job-1"]);
    expect(waveB).toHaveLength(0);
  });

  it("orders wave B with scene partners first then other heavy jobs", () => {
    const plan = validateWorkPlanV1({
      schemaId: "work-plan-v1",
      summary: "Mixed heavy jobs.",
      jobs: [
        {
          id: "job-1",
          kind: "run-catalog-agent",
          title: "Marked heavy",
          instruction: "Deep pass.",
          catalogAgentId: "idea-midwife",
          heavy: true
        },
        {
          id: "job-2",
          kind: "open-scene-partner",
          title: "Partner A",
          instruction: "First brief."
        },
        {
          id: "job-3",
          kind: "open-scene-partner",
          title: "Partner B",
          instruction: "Second brief."
        }
      ]
    });

    const { waveA, waveB } = planWorkPlanWaves(plan);
    expect(waveA).toHaveLength(0);
    expect(waveB.map((item) => item.id)).toEqual(["job-2", "job-3", "job-1"]);
  });
});
