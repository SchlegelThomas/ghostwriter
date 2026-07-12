import { describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  bookId,
  CANVAS_MUTATION_CAPABILITIES,
  CANVAS_READ_CAPABILITIES,
  createProject,
  defineProjectRecords,
  DomainValidationError,
  GHOSTWRITER_CAPABILITIES,
  projectId,
  PROJECT_COMMAND_CAPABILITIES,
  PROJECT_NAVIGATOR_CAPABILITY,
  SCENE_HISTORY_CAPABILITIES,
  SCENE_WORKSPACE_CAPABILITY,
  SCENE_WRITING_MUTATION_CAPABILITIES,
  sceneId,
  type BookId
} from "./index.js";

function expectValidationCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected a domain validation error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe(code);
  }
}

describe("multi-book project records", () => {
  it("projects the canonical book, chapter, and scene order", () => {
    expect(BELLWETHER_FIXTURE_NAVIGATOR.title).toBe("The Bellwether Cycle");
    expect(BELLWETHER_FIXTURE_NAVIGATOR.totals).toEqual({
      books: 2,
      scenes: 6,
      storyKnowledge: 4,
      editions: 1
    });
    expect(BELLWETHER_FIXTURE_NAVIGATOR.books.map((book) => book.title)).toEqual([
      "The Signal at Bellwether",
      "The Dark Between Tides"
    ]);
    expect(
      BELLWETHER_FIXTURE_NAVIGATOR.books[0]?.parts[0]?.chapters[0]?.scenes.map(
        (scene) => scene.title
      )
    ).toEqual(["Arrival at Bellwether", "The dead frequency"]);
    expect(BELLWETHER_FIXTURE_NAVIGATOR.books[0]?.unassignedScenes[0]?.title).toBe(
      "The false rescue"
    );
  });

  it("freezes records and ordered references", () => {
    const bookIds = BELLWETHER_FIXTURE.project.bookIds as BookId[];

    expect(Object.isFrozen(BELLWETHER_FIXTURE.project)).toBe(true);
    expect(Object.isFrozen(BELLWETHER_FIXTURE.project.bookIds)).toBe(true);
    expect(() => bookIds.push(bookId("book-illegal-mutation"))).toThrow();
    expect(BELLWETHER_FIXTURE.project.bookIds).toHaveLength(2);
  });

  it("rejects empty identity and title values", () => {
    expectValidationCode(() => projectId("   "), "EMPTY_VALUE");
    expectValidationCode(
      () =>
        createProject({
          id: projectId("project-empty-title"),
          title: " ",
          bookIds: [bookId("book-one")],
          createdAt: "2026-07-11T18:00:00.000Z"
        }),
      "EMPTY_VALUE"
    );
  });

  it("rejects duplicate IDs across record kinds", () => {
    const firstBook = BELLWETHER_FIXTURE.books[0];
    expect(firstBook).toBeDefined();

    expectValidationCode(
      () =>
        defineProjectRecords({
          ...BELLWETHER_FIXTURE,
          scenes: BELLWETHER_FIXTURE.scenes.map((scene, index) =>
            index === 0
              ? {
                  ...scene,
                  id: sceneId(firstBook?.id ?? "missing-book")
                }
              : scene
          )
        }),
      "DUPLICATE_ID"
    );
  });

  it("rejects manuscript references that do not match book scenes", () => {
    const [firstBook, ...otherBooks] = BELLWETHER_FIXTURE.books;
    expect(firstBook).toBeDefined();

    expectValidationCode(
      () =>
        defineProjectRecords({
          ...BELLWETHER_FIXTURE,
          books: [
            {
              ...firstBook!,
              manuscript: {
                ...firstBook!.manuscript,
                unassignedSceneIds: [sceneId("scene-not-in-this-project")]
              }
            },
            ...otherBooks
          ]
        }),
      "UNKNOWN_REFERENCE"
    );
  });

  it("rejects edition scene references from another book", () => {
    const edition = BELLWETHER_FIXTURE.editions[0];
    const otherBookScene = BELLWETHER_FIXTURE.scenes.find(
      (scene) => scene.bookId === BELLWETHER_FIXTURE.books[1]?.id
    );
    expect(edition).toBeDefined();
    expect(otherBookScene).toBeDefined();

    expectValidationCode(
      () =>
        defineProjectRecords({
          ...BELLWETHER_FIXTURE,
          editions: [
            {
              ...edition!,
              sceneRevisions: [
                {
                  ...edition!.sceneRevisions[0]!,
                  sceneId: otherBookScene!.id
                }
              ]
            }
          ]
        }),
      "CROSS_BOOK_REFERENCE"
    );
  });
});

describe("capability parity registry", () => {
  it("binds the project navigator query to UI and MCP", () => {
    expect(GHOSTWRITER_CAPABILITIES).toContain(PROJECT_NAVIGATOR_CAPABILITY);
    expect(PROJECT_NAVIGATOR_CAPABILITY).toMatchObject({
      access: "read",
      coreUseCase: "getProjectNavigator",
      bindings: {
        ui: "ProjectNavigatorScreen",
        mcp: "ghostwriter_project_navigator"
      }
    });
  });

  it("records an explicit MCP security exception for every canonical command", () => {
    expect(PROJECT_COMMAND_CAPABILITIES).toHaveLength(22);
    for (const capability of PROJECT_COMMAND_CAPABILITIES) {
      expect(capability.access).toBe("apply");
      expect(capability.bindings.ui).toBe("AuthenticatedProjectWorkspace");
      expect(capability.bindings.mcp).toBeUndefined();
      expect(capability.bindings.mcpException).toContain("scoped agent grants");
    }
  });

  it("registers authenticated scene web bindings without enabling MCP writes", () => {
    expect(GHOSTWRITER_CAPABILITIES).toContain(SCENE_WORKSPACE_CAPABILITY);
    expect(SCENE_WORKSPACE_CAPABILITY.bindings.web).toContain("/workspace");
    expect("mcp" in SCENE_WORKSPACE_CAPABILITY.bindings).toBe(false);
    for (const capability of SCENE_HISTORY_CAPABILITIES) {
      expect(capability.bindings.web).toContain("/api/projects/");
      expect(capability.bindings.mcp).toBeUndefined();
      expect(capability.bindings.mcpException).toContain(
        "authenticated project authority"
      );
    }
    for (const capability of SCENE_WRITING_MUTATION_CAPABILITIES) {
      expect(capability.bindings.web).toContain("/api/projects/");
      expect(capability.bindings.mcp).toBeUndefined();
      expect(capability.bindings.mcpException).toContain("scoped agent grants");
    }
  });

  it("registers Canvas backend bindings with explicit MCP exceptions", () => {
    for (const capability of [
      ...CANVAS_READ_CAPABILITIES,
      ...CANVAS_MUTATION_CAPABILITIES
    ]) {
      expect(GHOSTWRITER_CAPABILITIES).toContain(capability);
      expect(capability.bindings.web).toContain("/api/projects/");
      expect(capability.bindings.mcp).toBeUndefined();
      expect(capability.bindings.mcpException).toBeTruthy();
    }
  });
});
