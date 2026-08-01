import type {
  BookId,
  ChapterId,
  PartId,
  SceneId,
  StoryKnowledgeId
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  buildAgentToolkitSelection,
  resolveAgentToolkitAction,
  type AgentToolkitSelection
} from "./workspace-agent-toolkit.js";

const bookId = "book-1" as BookId;
const sceneId = "scene-1" as SceneId;
const storyKnowledgeId = "sk-1" as StoryKnowledgeId;
const captureId = "capture-1";

function selection(
  overrides: Partial<AgentToolkitSelection> = {}
): AgentToolkitSelection {
  return { ...overrides };
}

describe("resolveAgentToolkitAction", () => {
  it("opens Scene Partner when a capture is selected", () => {
    const result = resolveAgentToolkitAction(
      "scene-partner",
      selection({ captureId })
    );
    expect(result).toEqual({
      ok: true,
      kind: "plans",
      deepLink: { captureId, workflowStep: "scene-partner" },
      statusMessage: "Opened Scene Partner in Plans."
    });
  });

  it("refuses Scene Partner without a capture", () => {
    const result = resolveAgentToolkitAction("scene-partner", selection());
    expect(result).toEqual({
      ok: false,
      refusalMessage:
        "Select an idea in Plans (draft or ready) before Scene Partner."
    });
  });

  it("refuses Scene Partner when capture is not partnerable", () => {
    const result = resolveAgentToolkitAction(
      "scene-partner",
      selection({ captureId, capturePartnerable: false })
    );
    expect(result.ok).toBe(false);
  });

  it("opens Sketch Partner with craft auto-start when capture and scene exist", () => {
    const result = resolveAgentToolkitAction(
      "sketch-partner",
      selection({ captureId, sceneId })
    );
    expect(result).toEqual({
      ok: true,
      kind: "plans",
      deepLink: {
        captureId,
        workflowStep: "craft-partner",
        craftSceneId: sceneId,
        autoStartWorkflowId: "sketch-partner.craft-fields"
      },
      statusMessage: "Opened Sketch Partner in Plans."
    });
  });

  it("refuses Sketch Partner without capture even when scene is selected", () => {
    const result = resolveAgentToolkitAction(
      "sketch-partner",
      selection({ sceneId })
    );
    expect(result).toEqual({
      ok: false,
      refusalMessage:
        "Select an idea in Plans (draft or ready) before Sketch Partner."
    });
  });

  it("refuses Sketch Partner without scene when capture is selected", () => {
    const result = resolveAgentToolkitAction(
      "sketch-partner",
      selection({ captureId })
    );
    expect(result).toEqual({
      ok: false,
      refusalMessage: "Choose a scene before asking this partner."
    });
  });

  it("opens Character Coach with sheet auto-start", () => {
    const result = resolveAgentToolkitAction(
      "character-coach",
      selection({ captureId, storyKnowledgeId })
    );
    expect(result).toEqual({
      ok: true,
      kind: "plans",
      deepLink: {
        captureId,
        workflowStep: "craft-partner",
        craftCharacterId: storyKnowledgeId,
        autoStartWorkflowId: "character-coach.sheet-fields"
      },
      statusMessage: "Opened Character Coach in Plans."
    });
  });

  it("refuses Character Coach without cast even when capture is selected", () => {
    const result = resolveAgentToolkitAction(
      "character-coach",
      selection({ captureId })
    );
    expect(result).toEqual({
      ok: false,
      refusalMessage: "Choose a cast member before Character Coach."
    });
  });

  it("refuses Character Coach without capture even when cast is selected", () => {
    const result = resolveAgentToolkitAction(
      "character-coach",
      selection({ storyKnowledgeId })
    );
    expect(result).toEqual({
      ok: false,
      refusalMessage:
        "Select an idea in Plans (draft or ready) before Character Coach."
    });
  });

  it("opens Worldkeeper with backdrop auto-start", () => {
    const result = resolveAgentToolkitAction(
      "worldkeeper",
      selection({ captureId, sceneId })
    );
    expect(result).toEqual({
      ok: true,
      kind: "plans",
      deepLink: {
        captureId,
        workflowStep: "worldkeeper",
        craftSceneId: sceneId,
        autoStartWorkflowId: "worldkeeper.backdrop-fields"
      },
      statusMessage: "Opened Worldkeeper in Plans."
    });
  });

  it("opens cover on Title Page when book is selected", () => {
    const result = resolveAgentToolkitAction("cover", selection({ bookId }));
    expect(result).toEqual({
      ok: true,
      kind: "cover",
      bookId,
      statusMessage: "Opened Title Page for cover options."
    });
  });

  it("refuses cover without book selection", () => {
    const result = resolveAgentToolkitAction("cover", selection());
    expect(result).toEqual({
      ok: false,
      refusalMessage:
        "Select a book (or open Title Page) before cover options."
    });
  });
});

describe("buildAgentToolkitSelection", () => {
  it("maps manuscript scene selection and inbox capture", () => {
    expect(
      buildAgentToolkitSelection(
        {
          kind: "scene",
          bookId,
          sceneId,
          partId: "part-1" as PartId,
          chapterId: "chapter-1" as ChapterId
        },
        sceneId,
        captureId
      )
    ).toEqual({
      bookId,
      sceneId,
      captureId
    });
  });

  it("maps story knowledge and selected scene fallback", () => {
    expect(
      buildAgentToolkitSelection(
        { kind: "storyKnowledge", storyKnowledgeId },
        sceneId,
        undefined
      )
    ).toEqual({
      sceneId,
      storyKnowledgeId
    });
  });
});
