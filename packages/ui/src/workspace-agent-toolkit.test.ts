import type {
  BookId,
  ChapterId,
  PartId,
  SceneId,
  StoryKnowledgeId
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  AGENT_CATALOG_STAGES,
  AGENT_TOOLKIT_ACTIONS,
  agentCatalogStageLabel,
  buildAgentToolkitSelection,
  findShippedToolkitId,
  findShippedCatalogAgentId,
  formatActiveCatalogPartnerSummary,
  resolveAgentToolkitAction,
  shippedToolkitIdsInCatalog,
  type AgentCatalogStageId,
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

const EXPECTED_STAGE_IDS: readonly AgentCatalogStageId[] = [
  "brainstorm",
  "structure",
  "writing",
  "editing",
  "commercial"
];

const SHIPPED_TOOLKIT_IDS = [
  "scene-partner",
  "cover",
  "character-coach",
  "worldkeeper",
  "sketch-partner"
] as const;

describe("AGENT_CATALOG_STAGES", () => {
  it("includes every stage with the correct label", () => {
    expect(AGENT_CATALOG_STAGES.map((stage) => stage.id)).toEqual(
      EXPECTED_STAGE_IDS
    );
    for (const stage of AGENT_CATALOG_STAGES) {
      expect(stage.label).toBe(agentCatalogStageLabel(stage.id));
    }
  });

  it("lists exactly the five shipped toolkit ids once each", () => {
    expect([...shippedToolkitIdsInCatalog()].sort()).toEqual(
      [...SHIPPED_TOOLKIT_IDS].sort()
    );
    const shippedInCatalog = AGENT_CATALOG_STAGES.flatMap((stage) =>
      stage.agents.flatMap((entry) => {
        const toolkitId = findShippedToolkitId(entry);
        return toolkitId === undefined ? [] : [toolkitId];
      })
    );
    expect(shippedInCatalog.sort()).toEqual([...SHIPPED_TOOLKIT_IDS].sort());
    expect(new Set(shippedInCatalog).size).toBe(SHIPPED_TOOLKIT_IDS.length);
  });

  it("derives AGENT_TOOLKIT_ACTIONS from shipped catalog entries", () => {
    expect(AGENT_TOOLKIT_ACTIONS.map((action) => action.id).sort()).toEqual(
      [...SHIPPED_TOOLKIT_IDS].sort()
    );
  });

  it("ships every planned catalog memo agent", () => {
    const ids = AGENT_CATALOG_STAGES.flatMap((stage) =>
      stage.agents.flatMap((entry) => {
        const id = findShippedCatalogAgentId(entry);
        return id === undefined ? [] : [id];
      })
    );
    expect(ids).toContain("genre-compass");
    expect(ids).toContain("character-coach-cast");
    expect(ids).toContain("market-fit");
    expect(ids).toHaveLength(18);
  });

  it("does not pass coming-soon entries to resolveAgentToolkitAction", () => {
    for (const stage of AGENT_CATALOG_STAGES) {
      for (const entry of stage.agents) {
        if (entry.status === "coming-soon") {
          expect(findShippedToolkitId(entry)).toBeUndefined();
        }
      }
    }
  });
});

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

describe("formatActiveCatalogPartnerSummary", () => {
  it("joins label and stage, and lens when present", () => {
    expect(
      formatActiveCatalogPartnerSummary({
        entryId: "idea-midwife",
        label: "Idea Midwife",
        stageId: "brainstorm"
      })
    ).toBe("Idea Midwife · Brainstorm");
    expect(
      formatActiveCatalogPartnerSummary({
        entryId: "story-architect",
        label: "Story Architect",
        stageId: "structure",
        lens: "save-the-cat"
      })
    ).toBe("Story Architect · Structure · save the cat");
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
