import { describe, expect, it } from "vitest";
import {
  HARRY_POTTER_FIXTURE,
  HARRY_POTTER_FIXTURE_NAVIGATOR,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
  HARRY_POTTER_SEED_CAPTURES,
  harryPotterSceneProse
} from "./harry-potter-fixture.js";

describe("Harry Potter hermetic fixture", () => {
  it("models all seven books in series order", () => {
    expect(HARRY_POTTER_FIXTURE.project.id).toBe(HARRY_POTTER_FIXTURE_PROJECT_ID);
    expect(HARRY_POTTER_FIXTURE.project.title).toBe("Harry Potter");
    expect(HARRY_POTTER_FIXTURE.books).toHaveLength(7);
    expect(HARRY_POTTER_FIXTURE.books.map((book) => book.title)).toEqual([
      "Harry Potter and the Philosopher's Stone",
      "Harry Potter and the Chamber of Secrets",
      "Harry Potter and the Prisoner of Azkaban",
      "Harry Potter and the Goblet of Fire",
      "Harry Potter and the Order of the Phoenix",
      "Harry Potter and the Half-Blood Prince",
      "Harry Potter and the Deathly Hallows"
    ]);
  });

  it("keeps manuscript placement consistent with scene rows", () => {
    const manuscriptSceneIds = HARRY_POTTER_FIXTURE.books.flatMap((book) => [
      ...book.manuscript.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => [...chapter.sceneIds])
      ),
      ...book.manuscript.unassignedSceneIds
    ]);
    const sceneRowIds = HARRY_POTTER_FIXTURE.scenes.map((scene) => scene.id);
    expect([...manuscriptSceneIds].sort()).toEqual([...sceneRowIds].sort());
    expect(HARRY_POTTER_FIXTURE.scenes.length).toBeGreaterThanOrEqual(16);
  });

  it("exposes navigator, prose, characters, and seed captures", () => {
    expect(HARRY_POTTER_FIXTURE_NAVIGATOR.books).toHaveLength(7);
    expect(
      HARRY_POTTER_FIXTURE.storyKnowledge.filter(
        (row) => row.kind === "character"
      ).length
    ).toBeGreaterThanOrEqual(6);
    const firstSceneId = HARRY_POTTER_FIXTURE.scenes[0]!.id;
    expect(harryPotterSceneProse(firstSceneId)?.length).toBeGreaterThan(20);
    expect(HARRY_POTTER_SEED_CAPTURES).toHaveLength(3);
  });

  it("attaches six seed portrait visuals to every cast character", () => {
    const characters = HARRY_POTTER_FIXTURE.storyKnowledge.filter(
      (row) => row.kind === "character"
    );
    expect(characters).toHaveLength(7);
    for (const character of characters) {
      expect(character.visuals).toHaveLength(6);
      for (const visual of character.visuals ?? []) {
        expect(visual.url).toContain(
          `/story-knowledge/${String(character.id)}/visuals/`
        );
        expect(visual.id).toMatch(/^visual-seed-portrait-[1-6]$/);
      }
    }
  });
});
