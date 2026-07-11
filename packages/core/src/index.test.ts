import { describe, expect, it } from "vitest";
import { addChapter, createManuscript } from "./index.js";

describe("manuscripts", () => {
  it("adds ordered chapters without mutating the prior manuscript", () => {
    const draft = createManuscript("manuscript-1", "The Glass Orchard");
    const revised = addChapter(draft, "chapter-1", "The Arrival");

    expect(draft.chapters).toEqual([]);
    expect(revised.chapters).toEqual([
      { id: "chapter-1", title: "The Arrival", order: 1 }
    ]);
  });
});
