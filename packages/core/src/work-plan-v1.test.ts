import { describe, expect, it } from "vitest";
import { isWorkPlanV1, validateWorkPlanV1 } from "./work-plan-v1.js";

const validPayload = {
  schemaId: "work-plan-v1",
  summary: "Run continuity and add Mara to Cast after this scene.",
  sceneId: "scene-1",
  jobs: [
    {
      id: "job-1",
      kind: "cast-reference-check",
      title: "Check Mara references",
      instruction: "Verify Mara is consistent with prior scenes."
    },
    {
      id: "job-2",
      kind: "create-story-knowledge",
      title: "Add Mara",
      instruction: "Capture Mara from this scene.",
      proposedName: "Mara",
      storyKnowledgeKind: "character"
    },
    {
      id: "job-3",
      kind: "run-catalog-agent",
      title: "Run Dialogue Coach",
      instruction: "Review dialogue rhythm.",
      catalogAgentId: "dialogue-coach"
    }
  ]
} as const;

describe("work-plan-v1", () => {
  it("validates a bounded work-plan payload", () => {
    const plan = validateWorkPlanV1(validPayload);
    expect(plan.schemaId).toBe("work-plan-v1");
    expect(plan.sceneId).toBe("scene-1");
    expect(plan.jobs).toHaveLength(3);
    expect(plan.jobs[1]?.proposedName).toBe("Mara");
    expect(isWorkPlanV1(plan)).toBe(true);
  });

  it("rejects unexpected fields and invalid schema id", () => {
    expect(() =>
      validateWorkPlanV1({ ...validPayload, extra: true })
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      validateWorkPlanV1({ ...validPayload, schemaId: "work-plan-v2" })
    ).toThrow(/schema identifier is invalid/u);
  });

  it("requires at least one job and caps at eight", () => {
    expect(() =>
      validateWorkPlanV1({ ...validPayload, jobs: [] })
    ).toThrow(/jobs are invalid/u);
    const jobs = Array.from({ length: 9 }, (_, index) => ({
      id: `job-${index + 1}`,
      kind: "cast-reference-check" as const,
      title: `Job ${index + 1}`,
      instruction: "Check references."
    }));
    expect(() =>
      validateWorkPlanV1({ ...validPayload, jobs })
    ).toThrow(/jobs are invalid/u);
  });

  it("enforces kind-specific required fields", () => {
    expect(() =>
      validateWorkPlanV1({
        ...validPayload,
        jobs: [
          {
            id: "job-1",
            kind: "run-catalog-agent",
            title: "Run agent",
            instruction: "Go."
          }
        ]
      })
    ).toThrow(/require catalogAgentId/u);
    expect(() =>
      validateWorkPlanV1({
        ...validPayload,
        jobs: [
          {
            id: "job-1",
            kind: "create-story-knowledge",
            title: "Add character",
            instruction: "Capture from scene.",
            proposedName: "Mara"
          }
        ]
      })
    ).toThrow(/require storyKnowledgeKind/u);
    expect(() =>
      validateWorkPlanV1({
        ...validPayload,
        jobs: [
          {
            id: "job-1",
            kind: "create-story-knowledge",
            title: "Add character",
            instruction: "Capture from scene.",
            storyKnowledgeKind: "character"
          }
        ]
      })
    ).toThrow(/require proposedName/u);
  });

  it("accepts cast-reference-check without catalogAgentId", () => {
    const plan = validateWorkPlanV1({
      schemaId: "work-plan-v1",
      summary: "Check cast.",
      jobs: [
        {
          id: "job-1",
          kind: "cast-reference-check",
          title: "Continuity check",
          instruction: "Verify names against Cast."
        }
      ]
    });
    expect(plan.jobs[0]?.catalogAgentId).toBeUndefined();
  });

  it("accepts open-scene-partner with instruction brief", () => {
    const plan = validateWorkPlanV1({
      schemaId: "work-plan-v1",
      summary: "Open partner.",
      jobs: [
        {
          id: "job-1",
          kind: "open-scene-partner",
          title: "Scene Partner",
          instruction: "Explore the rain-soaked confrontation beat."
        }
      ]
    });
    expect(plan.jobs[0]?.kind).toBe("open-scene-partner");
  });
});
