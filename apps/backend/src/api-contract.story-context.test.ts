import { describe, expect, it } from "vitest";
import {
  executeProjectCommandRequestSchema,
  toProjectCommand
} from "./api-contract.js";

function parseCommand(command: unknown) {
  const parsed = executeProjectCommandRequestSchema.safeParse({
    expectedVersion: 7,
    command
  });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw parsed.error;
  return toProjectCommand(parsed.data.command);
}

describe("story context project command API contracts", () => {
  it("maps every scene-intent and narrative command into branded core commands", () => {
    expect(
      parseCommand({
        type: "scene.updateIntent",
        sceneId: "scene-arrival",
        patch: {
          purpose: "Answer the impossible call.",
          conflict: null,
          openQuestions: "Who placed it?"
        }
      })
    ).toEqual({
      type: "scene.updateIntent",
      sceneId: "scene-arrival",
      patch: {
        purpose: "Answer the impossible call.",
        conflict: null,
        openQuestions: "Who placed it?"
      }
    });

    expect(
      parseCommand({
        type: "storyKnowledge.addNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        sceneId: "scene-arrival",
        role: "setup",
        summary: "The first warning arrives.",
        dependsOnBeatIds: ["beat-prologue"]
      })
    ).toEqual({
      type: "storyKnowledge.addNarrativeBeat",
      storyKnowledgeId: "thread-caller",
      sceneId: "scene-arrival",
      role: "setup",
      summary: "The first warning arrives.",
      dependsOnBeatIds: ["beat-prologue"]
    });

    expect(
      parseCommand({
        type: "storyKnowledge.updateNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        beatId: "beat-warning",
        patch: {
          sceneId: "scene-dead-frequency",
          role: "consequence",
          summary: "The warning names a victim.",
          dependsOnBeatIds: ["beat-prologue"]
        }
      })
    ).toEqual({
      type: "storyKnowledge.updateNarrativeBeat",
      storyKnowledgeId: "thread-caller",
      beatId: "beat-warning",
      patch: {
        sceneId: "scene-dead-frequency",
        role: "consequence",
        summary: "The warning names a victim.",
        dependsOnBeatIds: ["beat-prologue"]
      }
    });

    expect(
      parseCommand({
        type: "storyKnowledge.setNarrativeBeatArchived",
        storyKnowledgeId: "thread-caller",
        beatId: "beat-warning",
        archived: true
      })
    ).toEqual({
      type: "storyKnowledge.setNarrativeBeatArchived",
      storyKnowledgeId: "thread-caller",
      beatId: "beat-warning",
      archived: true
    });

    expect(
      parseCommand({
        type: "storyKnowledge.setNarrativeResolution",
        storyKnowledgeId: "thread-caller",
        resolution: "intentionally-open"
      })
    ).toEqual({
      type: "storyKnowledge.setNarrativeResolution",
      storyKnowledgeId: "thread-caller",
      resolution: "intentionally-open"
    });
  });

  it("rejects open, empty, invalid, and oversized narrative payloads", () => {
    const tooManyDependencies = Array.from(
      { length: 101 },
      (_, index) => `beat-${index}`
    );
    const invalidCommands = [
      {
        type: "scene.updateIntent",
        sceneId: "scene-arrival",
        patch: {}
      },
      {
        type: "scene.updateIntent",
        sceneId: "scene-arrival",
        patch: { purpose: "Valid", extra: true }
      },
      {
        type: "scene.updateIntent",
        sceneId: "scene-arrival",
        patch: { purpose: "x".repeat(2_001) }
      },
      {
        type: "storyKnowledge.addNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        sceneId: "scene-arrival",
        role: "opening",
        summary: "A warning."
      },
      {
        type: "storyKnowledge.addNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        sceneId: "scene-arrival",
        role: "setup",
        summary: "A warning.",
        dependsOnBeatIds: tooManyDependencies
      },
      {
        type: "storyKnowledge.updateNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        beatId: "beat-warning",
        patch: {}
      },
      {
        type: "storyKnowledge.updateNarrativeBeat",
        storyKnowledgeId: "thread-caller",
        beatId: "beat-warning",
        patch: { summary: "x".repeat(5_001) }
      },
      {
        type: "storyKnowledge.setNarrativeBeatArchived",
        storyKnowledgeId: "thread-caller",
        beatId: "",
        archived: true
      },
      {
        type: "storyKnowledge.setNarrativeResolution",
        storyKnowledgeId: "thread-caller",
        resolution: "unknown",
        extra: true
      }
    ];

    for (const command of invalidCommands) {
      expect(
        executeProjectCommandRequestSchema.safeParse({
          expectedVersion: 7,
          command
        }).success
      ).toBe(false);
    }
  });
});
