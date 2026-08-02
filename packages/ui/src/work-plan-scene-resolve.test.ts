import { describe, expect, it } from "vitest";
import type { WorkPlanV1 } from "@ghostwriter/core";
import { resolveWorkPlanScenes } from "./work-plan-scene-resolve.js";

const scenes = Object.freeze([
  Object.freeze({
    id: "scene-hp-philosophers-stone-letter-arrives",
    title: "The first letter"
  }),
  Object.freeze({
    id: "scene-other",
    title: "Ollivanders"
  })
]);

describe("resolveWorkPlanScenes", () => {
  it("maps scene titles to ids and fills missing from fallback", () => {
    const plan: WorkPlanV1 = Object.freeze({
      schemaId: "work-plan-v1",
      summary: "Jobs",
      sceneId: "The first letter",
      jobs: Object.freeze([
        Object.freeze({
          id: "job-1",
          kind: "run-catalog-agent" as const,
          title: "Dialogue Coach",
          instruction: "Polish.",
          catalogAgentId: "dialogue-coach",
          sceneId: "The first letter"
        }),
        Object.freeze({
          id: "job-2",
          kind: "create-story-knowledge" as const,
          title: "Letter",
          instruction: "Artifact.",
          proposedName: "The Mysterious Letter",
          storyKnowledgeKind: "custom" as const
        })
      ])
    });

    const resolved = resolveWorkPlanScenes(
      plan,
      scenes,
      "scene-hp-philosophers-stone-letter-arrives"
    );
    expect(resolved.sceneId).toBe(
      "scene-hp-philosophers-stone-letter-arrives"
    );
    expect(resolved.jobs[0]?.sceneId).toBe(
      "scene-hp-philosophers-stone-letter-arrives"
    );
    expect(resolved.jobs[1]?.sceneId).toBe(
      "scene-hp-philosophers-stone-letter-arrives"
    );
  });
});
