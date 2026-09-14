import {
  bookId,
  canvasObjectId,
  chapterId,
  partId,
  projectId,
  sceneId,
  type ProjectNavigator
} from "@ghostwriter/core";
import { describe, expect, it } from "vitest";
import {
  canvasExplicitMemberships,
  canvasMembershipDestinations,
  canvasScopeTitle
} from "./canvas-membership.js";

const project: ProjectNavigator = {
  id: projectId("project-membership"),
  title: "Harbor Lights",
  version: 1,
  books: [
    {
      id: bookId("book-active"),
      title: "Book One",
      status: "drafting",
      parts: [
        {
          id: partId("part-one"),
          title: "Part One",
          chapters: [
            {
              id: chapterId("chapter-opening"),
              title: "Opening",
              scenes: [
                {
                  id: sceneId("scene-lighthouse"),
                  title: "Lighthouse",
                  status: "drafting"
                }
              ]
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 1
    },
    {
      id: bookId("book-archived"),
      title: "Old Book",
      status: "planned",
      archivedAt: "2026-09-12T00:00:00.000Z",
      parts: [
        {
          id: partId("part-old"),
          title: "Old Part",
          chapters: [
            {
              id: chapterId("chapter-old"),
              title: "Old Chapter",
              scenes: []
            }
          ]
        }
      ],
      unassignedScenes: [],
      editions: [],
      sceneCount: 0
    }
  ],
  storyKnowledge: [],
  totals: { books: 2, scenes: 1, storyKnowledge: 0, editions: 0 }
};

describe("Canvas membership presentation", () => {
  it("searches active chapter and scene destinations with a hard limit", () => {
    expect(canvasMembershipDestinations(project, "light", 1)).toHaveLength(1);
    expect(canvasMembershipDestinations(project, "old")).toHaveLength(0);
  });

  it("names the current scope", () => {
    expect(
      canvasScopeTitle(project, {
        kind: "scene",
        bookId: bookId("book-active"),
        sceneId: sceneId("scene-lighthouse")
      })
    ).toContain("Lighthouse");
  });

  it("keeps stale explicit inclusions removable with readable status", () => {
    const statuses = canvasExplicitMemberships(
      project,
      [
        {
          objectId: canvasObjectId("canvas-object-note"),
          scopeKind: "chapter",
          scopeId: "chapter-old",
          membership: "explicit",
          x: 10,
          y: 20
        }
      ],
      canvasObjectId("canvas-object-note")
    );
    expect(statuses[0]).toMatchObject({
      available: false,
      scopeKind: "chapter",
      scopeId: "chapter-old"
    });
    expect(statuses[0]?.label).toContain("Unavailable");
    expect(statuses[0]?.label).toContain("Old Chapter");
  });
});
