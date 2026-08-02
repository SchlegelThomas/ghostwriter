import {
  bookId,
  chapterId,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type ProjectNavigator,
  type ProjectNavigatorScene
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  entityDraftAccessibilityLabel,
  entityDraftCardSummary,
  entityDraftCardTitle,
  entityDraftKindLabel,
  entityDraftPartnerLabel,
  entityDraftPrimaryAction,
  entityDraftPrimaryActionLabel,
  entityDraftRowTitle,
  entityDraftSchemaLabel,
  entityDraftTargetForSelection,
  formatEntityDraftCreatedAt,
  formatEntityDraftDetailBody,
  truncateEntityDraftSummary,
  truncateEntityDraftTitle
} from "./entity-draft-model.js";

const project = projectId("project-drafts");
const book = bookId("book-drafts");
const part = partId("part-drafts");
const chapter = chapterId("chapter-drafts");
const scene = sceneId("scene-drafts");
const castMember = storyKnowledgeId("cast-drafts");

function navigatorScene(
  id: typeof scene,
  title: string
): ProjectNavigatorScene {
  return { id, title, status: "drafting" };
}

const PROJECT: ProjectNavigator = {
  id: project,
  title: "Test project",
  version: 1,
  books: [
    {
      id: book,
      title: "Book one",
      status: "drafting",
      sceneCount: 1,
      editions: [],
      parts: [
        {
          id: part,
          title: "Part one",
          chapters: [
            {
              id: chapter,
              title: "Chapter one",
              scenes: [navigatorScene(scene, "Opening scene")]
            }
          ]
        }
      ],
      unassignedScenes: []
    }
  ],
  storyKnowledge: [
    {
      id: castMember,
      label: "Hero",
      kind: "character",
      authority: "planned",
      linkedSceneIds: [],
      linkedSceneCount: 0,
      linkedKnowledge: []
    }
  ],
  totals: { books: 1, scenes: 1, storyKnowledge: 1, editions: 0 }
};

describe("entityDraftSchemaLabel", () => {
  it("maps known schema ids to writer-facing labels", () => {
    expect(entityDraftSchemaLabel("plan-outline-v1")).toBe("Plan outline");
    expect(entityDraftSchemaLabel("capture-reflection-v1")).toBe("Scene Partner");
    expect(entityDraftSchemaLabel("sketch-fields-v1")).toBe("Sketch Partner");
    expect(entityDraftSchemaLabel("pacing-findings-v1")).toBe("Pacing Doctor");
  });

  it("falls back for unknown schema ids", () => {
    expect(entityDraftSchemaLabel("unknown-v9")).toBe("Agent draft");
  });
});

describe("entityDraftTargetForSelection", () => {
  it("returns project target for project selection", () => {
    expect(
      entityDraftTargetForSelection(PROJECT, { kind: "project" })
    ).toEqual({
      targetKind: "project",
      targetId: project
    });
  });

  it("returns scene target for scene selection", () => {
    expect(
      entityDraftTargetForSelection(PROJECT, {
        kind: "scene",
        bookId: book,
        partId: part,
        chapterId: chapter,
        sceneId: scene
      })
    ).toEqual({
      targetKind: "scene",
      targetId: scene
    });
  });

  it("returns story-knowledge target for cast selection", () => {
    expect(
      entityDraftTargetForSelection(PROJECT, {
        kind: "storyKnowledge",
        storyKnowledgeId: castMember
      })
    ).toEqual({
      targetKind: "story-knowledge",
      targetId: castMember
    });
  });

  it("returns undefined for non-draft selections", () => {
    expect(
      entityDraftTargetForSelection(PROJECT, {
        kind: "book",
        bookId: book
      })
    ).toBeUndefined();
  });
});

describe("entityDraftPrimaryAction", () => {
  it("prefers acknowledge for plan outlines", () => {
    expect(
      entityDraftPrimaryAction({
        id: "p1",
        outputSchemaId: "plan-outline-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("acknowledge");
    expect(
      entityDraftPrimaryAction({
        id: "p-pacing",
        outputSchemaId: "pacing-findings-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("acknowledge");
    expect(
      entityDraftPrimaryAction({
        id: "p-catalog",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("acknowledge");
    expect(
      entityDraftPrimaryAction({
        id: "p-next",
        outputSchemaId: "next-action-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("acknowledge");
    expect(
      entityDraftPrimaryAction({
        id: "p-sk",
        outputSchemaId: "story-knowledge-create-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("acknowledge");
  });

  it("opens capture-bound drafts in Plans", () => {
    expect(
      entityDraftPrimaryAction({
        id: "p2",
        outputSchemaId: "capture-reflection-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        baseCaptureId: "capture-1"
      })
    ).toBe("open-in-plans");
  });
});

describe("formatEntityDraftDetailBody", () => {
  it("formats story-knowledge create drafts for review", () => {
    const body = formatEntityDraftDetailBody("story-knowledge-create-v1", {
      schemaId: "story-knowledge-create-v1",
      name: "Jonah",
      kind: "character",
      summary: "A ferry passenger scanning the fog.",
      firstAppearanceNote: "Named in the arrival scene."
    });
    expect(body).toContain("Name: Jonah");
    expect(body).toContain("Kind: character");
    expect(body).toContain("A ferry passenger scanning the fog.");
    expect(body).toContain("First appearance:");
  });

  it("formats next-action summary and suggestion titles", () => {
    const body = formatEntityDraftDetailBody("next-action-v1", {
      summary: "Two new names appear in this scene.",
      suggestions: [
        { kind: "create-story-knowledge", title: "Add Mara to Cast", rationale: "Named twice." },
        { kind: "continue-writing", title: "Keep drafting", rationale: "Strong turn." }
      ]
    });
    expect(body).toContain("Two new names appear in this scene.");
    expect(body).toContain("· Add Mara to Cast");
    expect(body).toContain("· Keep drafting");
  });

  it("formats pacing turns and prescriptions for review", () => {
    const body = formatEntityDraftDetailBody("pacing-findings-v1", {
      summary: "The middle arrives late.",
      turns: [
        {
          id: "midpoint",
          sceneTitle: "The signal",
          measuredPct: 62.5,
          bandLow: 45,
          bandHigh: 55
        }
      ],
      prescriptions: [{ action: "add-pressure", body: "Give the rival a plan." }]
    });
    expect(body).toContain("Midpoint | The signal | 62.5% (band 45–55%)");
    expect(body).toContain("· add pressure: Give the rival a plan.");
  });
});

describe("entityDraftKindLabel", () => {
  it("maps schema ids to short kind chips", () => {
    expect(entityDraftKindLabel("catalog-memo-v1")).toBe("Memo");
    expect(entityDraftKindLabel("pacing-findings-v1")).toBe("Pacing");
    expect(entityDraftKindLabel("next-action-v1")).toBe("Next actions");
    expect(entityDraftKindLabel("capture-reflection-v1")).toBe("Scene Partner");
  });
});

describe("entityDraftCardTitle", () => {
  it("prefers preview title over partner and kind", () => {
    expect(
      entityDraftCardTitle({
        id: "p1",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        preview: {
          agentLabel: "Idea Midwife",
          title: "Harry Potter",
          summary: "Strong opening promise."
        }
      })
    ).toBe("Harry Potter");
  });

  it("falls back to partner then kind", () => {
    expect(
      entityDraftCardTitle({
        id: "p2",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        preview: { agentLabel: "Genre Compass" }
      })
    ).toBe("Genre Compass");
    expect(
      entityDraftCardTitle({
        id: "p3",
        outputSchemaId: "plan-outline-v1",
        createdAt: "2026-08-01T12:00:00.000Z"
      })
    ).toBe("Plan outline");
  });
});

describe("entityDraftPartnerLabel", () => {
  it("returns preview agent label when present", () => {
    expect(
      entityDraftPartnerLabel({
        id: "p1",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        preview: { agentLabel: "Idea Midwife" }
      })
    ).toBe("Idea Midwife");
  });
});

describe("entityDraftCardSummary", () => {
  it("returns truncated preview summary", () => {
    const longSummary = "x".repeat(300);
    expect(
      entityDraftCardSummary({
        id: "p1",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        preview: { summary: longSummary }
      })
    ).toBe(truncateEntityDraftSummary(longSummary));
  });
});

describe("entityDraftAccessibilityLabel", () => {
  it("includes kind, partner, and title", () => {
    expect(
      entityDraftAccessibilityLabel({
        id: "p1",
        outputSchemaId: "catalog-memo-v1",
        createdAt: "2026-08-01T12:00:00.000Z",
        preview: {
          agentLabel: "Idea Midwife",
          title: "Harry Potter",
          summary: "Strong opening promise."
        }
      })
    ).toBe("Memo, Idea Midwife, Harry Potter");
  });
});

describe("entityDraftRowTitle", () => {
  it("combines schema label with truncated detail title", () => {
    const detailTitle =
      "A very long outline title that should be shortened for the row";
    expect(
      entityDraftRowTitle(
        {
          id: "p1",
          outputSchemaId: "plan-outline-v1",
          createdAt: "2026-08-01T12:00:00.000Z"
        },
        detailTitle
      )
    ).toBe(
      `Plan outline · ${truncateEntityDraftTitle(detailTitle)}`
    );
  });
});

describe("formatEntityDraftCreatedAt", () => {
  it("formats valid ISO timestamps", () => {
    expect(formatEntityDraftCreatedAt("not-a-date")).toBe("not-a-date");
    expect(formatEntityDraftCreatedAt("2026-08-01T18:30:00.000Z")).toMatch(
      /Aug/
    );
  });
});

describe("truncateEntityDraftTitle", () => {
  it("leaves short titles intact", () => {
    expect(truncateEntityDraftTitle("Act I beats")).toBe("Act I beats");
  });
});

describe("entityDraftPrimaryActionLabel", () => {
  it("returns writer-facing action labels", () => {
    expect(entityDraftPrimaryActionLabel("view")).toBe("View");
    expect(entityDraftPrimaryActionLabel("open-in-plans")).toBe("Open in Plans");
    expect(entityDraftPrimaryActionLabel("acknowledge")).toBe("Acknowledge");
    expect(
      entityDraftPrimaryActionLabel("acknowledge", "story-knowledge-create-v1")
    ).toBe("Add to Cast");
  });
});
