import { describe, expect, it } from "vitest";
import {
  buildStoryStructureDependencyMap,
  computeStoryStructureRequiredClosure,
  validateStoryStructureOperationGraph,
  validateStoryStructureOperationSelection
} from "./story-structure-operation-graph.js";
import {
  STORY_STRUCTURE_SCHEMA_ID,
  storyStructureOperationId,
  type StoryStructureDependency,
  type StoryStructureOperation
} from "./story-structure-proposal-v1.js";
import { bookId, chapterId, partId, projectId, sceneId } from "./domain.js";
import { instructionContentHash } from "./agent-domain.js";
import { DomainValidationError } from "./domain.js";

const BOOK = bookId("book-structure");
const PROJECT = projectId("project-structure");
const RECEIPT = instructionContentHash("a".repeat(64));

function op(
  id: string,
  type: StoryStructureOperation["type"] = "part.create"
): StoryStructureOperation {
  const operationId = storyStructureOperationId(id);
  switch (type) {
    case "part.create":
      return Object.freeze({
        type: "part.create",
        operationId,
        bookId: BOOK,
        partId: partId("part-1"),
        title: "Part"
      });
    case "chapter.create":
      return Object.freeze({
        type: "chapter.create",
        operationId,
        bookId: BOOK,
        partId: partId("part-1"),
        chapterId: chapterId("chapter-1"),
        title: "Chapter"
      });
    case "scene.createPlanned":
      return Object.freeze({
        type: "scene.createPlanned",
        operationId,
        bookId: BOOK,
        sceneId: sceneId("scene-1"),
        title: "Scene"
      });
    default:
      return Object.freeze({
        type: "part.create",
        operationId,
        bookId: BOOK,
        partId: partId("part-1"),
        title: "Part"
      });
  }
}

function completeDependencies(
  operations: readonly StoryStructureOperation[],
  edges: readonly StoryStructureDependency[]
): readonly StoryStructureDependency[] {
  const requiresById = new Map(edges.map((edge) => [edge.operationId, edge.requires]));
  return Object.freeze(
    operations.map((operation) =>
      Object.freeze({
        operationId: operation.operationId,
        requires: Object.freeze(requiresById.get(operation.operationId) ?? [])
      })
    )
  );
}

function proposal(
  operations: readonly StoryStructureOperation[],
  edges: readonly StoryStructureDependency[]
) {
  return Object.freeze({
    schemaId: STORY_STRUCTURE_SCHEMA_ID,
    projectId: PROJECT,
    bookId: BOOK,
    expectedProjectVersion: 3,
    contextReceiptHash: RECEIPT,
    operations,
    dependencies: completeDependencies(operations, edges)
  });
}

describe("story-structure-operation-graph", () => {
  it("rejects duplicate dependency records for the same operation id", () => {
    const a = storyStructureOperationId("op-a");
    expect(() => buildStoryStructureDependencyMap([
      { operationId: a, requires: [] },
      { operationId: a, requires: [] }
    ])).toThrow(DomainValidationError);
  });

  it("rejects cycles and self dependencies", () => {
    const a = storyStructureOperationId("op-a");
    const b = storyStructureOperationId("op-b");
    expect(() =>
      validateStoryStructureOperationGraph(
        proposal([op("op-a"), op("op-b")], [
          { operationId: a, requires: [b] },
          { operationId: b, requires: [a] }
        ])
      )
    ).toThrow(DomainValidationError);
    expect(() =>
      validateStoryStructureOperationGraph(
        proposal([op("op-a")], [{ operationId: a, requires: [a] }])
      )
    ).toThrow(DomainValidationError);
  });

  it("computes transitive required closure deterministically", () => {
    const a = storyStructureOperationId("op-a");
    const b = storyStructureOperationId("op-b");
    const c = storyStructureOperationId("op-c");
    const dependencies = completeDependencies(
      [op("op-a"), op("op-b", "chapter.create"), op("op-c", "scene.createPlanned")],
      [
        { operationId: b, requires: [a] },
        { operationId: c, requires: [b] }
      ]
    );
    expect(computeStoryStructureRequiredClosure([c], dependencies)).toEqual([a, b, c]);
  });

  it("returns missing requirements without widening partial selection", () => {
    const createPart = op("op-part");
    const createChapter = op("op-chapter", "chapter.create");
    const createScene = op("op-scene", "scene.createPlanned");
    const base = proposal([createPart, createChapter, createScene], [
      {
        operationId: createChapter.operationId,
        requires: [createPart.operationId]
      },
      {
        operationId: createScene.operationId,
        requires: [createChapter.operationId]
      }
    ]);

    const missing = validateStoryStructureOperationSelection({
      ...base,
      selectedOperationIds: [createScene.operationId]
    });
    expect(missing).toMatchObject({
      ok: false,
      code: "MISSING_REQUIREMENTS",
      missingRequired: [createChapter.operationId, createPart.operationId]
    });

    const dependentAllowed = validateStoryStructureOperationSelection({
      ...base,
      selectedOperationIds: [createPart.operationId]
    });
    expect(dependentAllowed).toMatchObject({ ok: true });
  });

  it("refuses empty selection", () => {
    const createPart = op("op-part");
    const result = validateStoryStructureOperationSelection({
      ...proposal([createPart], [{ operationId: createPart.operationId, requires: [] }]),
      selectedOperationIds: []
    });
    expect(result).toMatchObject({ ok: false, code: "EMPTY_SELECTION" });
  });
});
