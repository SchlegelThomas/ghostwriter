import { describe, expect, it } from "vitest";
import {
  buildStoryStructureHermeticCandidatesOutput,
  extractStoryStructureHermeticTargetBookId
} from "./story-structure-hermetic-candidates.js";

function compilerShapedInputText(bookId: string): string {
  return [
    "=== ORIGINAL WRITER BRIEF (exact) ===",
    "Develop a three-chapter outline.",
    "=== TARGET BOOK ID (exact) ===",
    bookId,
    "=== EXPECTED PROJECT VERSION (exact) ===",
    "1"
  ].join("\n");
}

describe("story structure hermetic candidates", () => {
  it("extracts the target book id marker from compiler-shaped input", () => {
    expect(
      extractStoryStructureHermeticTargetBookId(
        compilerShapedInputText("book-signal-at-bellwether")
      )
    ).toBe("book-signal-at-bellwether");
  });

  it("returns one part, three chapters/scenes, and exact chapter order without prose or ids", () => {
    const output = buildStoryStructureHermeticCandidatesOutput(
      compilerShapedInputText("book-signal-at-bellwether")
    );
    expect(output.schemaId).toBe("story-structure-proposal-candidates-v1");
    expect(output.newParts).toHaveLength(1);
    expect(output.newChapters).toHaveLength(3);
    expect(output.newChapters.every((chapter) => chapter.objective?.trim())).toBe(true);
    expect(output.newPlannedScenes).toHaveLength(3);
    expect(output.chapterReorders[0]?.order.map((entry) => entry.localKey)).toEqual([
      "ch-1",
      "ch-2",
      "ch-3"
    ]);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/scene-/);
    expect(serialized).not.toContain("prose");
    expect(serialized).not.toContain("canvas");
  });
});
