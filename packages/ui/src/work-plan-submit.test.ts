import { describe, expect, it } from "vitest";
import {
  isWorkPlanSubmitIntent,
  latestWorkPlanFromMessages,
  workPlanFromNextActionV1
} from "./work-plan-submit.js";
import type { NextActionV1, WorkPlanV1 } from "@ghostwriter/core";

const samplePlan: WorkPlanV1 = Object.freeze({
  schemaId: "work-plan-v1",
  summary: "Three useful jobs.",
  sceneId: "scene-1",
  jobs: Object.freeze([
    Object.freeze({
      id: "job-1",
      kind: "run-catalog-agent" as const,
      title: "Dialogue Coach",
      instruction: "Check dialogue.",
      catalogAgentId: "dialogue-coach",
      sceneId: "scene-1"
    })
  ])
});

describe("isWorkPlanSubmitIntent", () => {
  it("accepts short confirmation phrases", () => {
    expect(isWorkPlanSubmitIntent("submit")).toBe(true);
    expect(isWorkPlanSubmitIntent(" Submit it ")).toBe(true);
    expect(isWorkPlanSubmitIntent("do it")).toBe(true);
    expect(isWorkPlanSubmitIntent("run them")).toBe(true);
    expect(isWorkPlanSubmitIntent("run it!")).toBe(true);
    expect(isWorkPlanSubmitIntent("go ahead")).toBe(true);
    expect(isWorkPlanSubmitIntent("let's do them all")).toBe(true);
    expect(isWorkPlanSubmitIntent("k lets do them all")).toBe(true);
    expect(isWorkPlanSubmitIntent("ok yep lets do all 4")).toBe(true);
  });

  it("rejects long or ambiguous text", () => {
    expect(isWorkPlanSubmitIntent("")).toBe(false);
    expect(
      isWorkPlanSubmitIntent(
        "please submit the work plan after you revise the outline"
      )
    ).toBe(false);
    expect(isWorkPlanSubmitIntent("what should I submit?")).toBe(false);
  });
});

describe("workPlanFromNextActionV1", () => {
  it("maps catalog, story knowledge, and plans open-surface suggestions", () => {
    const payload: NextActionV1 = Object.freeze({
      schemaId: "next-action-v1",
      trigger: "manual-start",
      summary: "Next moves for this scene.",
      suggestions: Object.freeze([
        Object.freeze({
          kind: "run-catalog-agent" as const,
          title: "Dialogue Coach",
          rationale: "Tighten exchanges.",
          catalogAgentId: "dialogue-coach"
        }),
        Object.freeze({
          kind: "create-story-knowledge" as const,
          title: "Add Mara",
          rationale: "New character appears.",
          proposedName: "Mara",
          storyKnowledgeKind: "character" as const
        }),
        Object.freeze({
          kind: "open-surface" as const,
          title: "Scene Partner",
          rationale: "Seed a brief in Plans.",
          openSurface: "plans" as const
        }),
        Object.freeze({
          kind: "continue-writing" as const,
          title: "Keep drafting",
          rationale: "Stay in the prose."
        })
      ])
    });

    const plan = workPlanFromNextActionV1(payload, "scene-1");
    expect(plan).toBeDefined();
    expect(plan?.schemaId).toBe("work-plan-v1");
    expect(plan?.sceneId).toBe("scene-1");
    expect(plan?.jobs).toHaveLength(3);
    expect(plan?.jobs.map((job) => job.kind)).toEqual([
      "run-catalog-agent",
      "create-story-knowledge",
      "open-scene-partner"
    ]);
  });

  it("returns undefined when nothing maps", () => {
    const payload: NextActionV1 = Object.freeze({
      schemaId: "next-action-v1",
      trigger: "manual-start",
      summary: "Keep writing.",
      suggestions: Object.freeze([
        Object.freeze({
          kind: "continue-writing" as const,
          title: "Continue",
          rationale: "Draft on."
        })
      ])
    });
    expect(workPlanFromNextActionV1(payload)).toBeUndefined();
  });
});

describe("latestWorkPlanFromMessages", () => {
  it("returns the newest assistant work plan", () => {
    const older: WorkPlanV1 = {
      ...samplePlan,
      summary: "Older plan."
    };
    const newer: WorkPlanV1 = {
      ...samplePlan,
      summary: "Newer plan."
    };
    expect(
      latestWorkPlanFromMessages([
        { role: "assistant", workPlan: older },
        { role: "user" },
        { role: "assistant", workPlan: newer },
        { role: "system" }
      ])?.summary
    ).toBe("Newer plan.");
  });

  it("skips messages without a plan", () => {
    expect(
      latestWorkPlanFromMessages([
        { role: "assistant" },
        { role: "user" }
      ])
    ).toBeUndefined();
  });
});
