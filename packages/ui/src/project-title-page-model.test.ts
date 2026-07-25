import { describe, expect, it } from "vitest";
import type { BookId } from "@ghostwriter/core";
import {
  bookCoverInitials,
  bookCoverPlaceholderColors,
  bookCoverTrailLabel,
  bookTitleStudioFingerprint,
  buildBookCoverImagePrompt
} from "./project-title-page-model.js";

describe("project title page model", () => {
  it("fingerprints book studio fields for draft sync", () => {
    const book = {
      id: "book-1" as BookId,
      title: "Stone Stairs",
      status: "drafting" as const,
      cover: {
        concept: "Amber light",
        notes: "Keep warm",
        imageUrl: "ghostwriter-cover://p/b"
      }
    };
    expect(bookTitleStudioFingerprint(book)).toBe(
      "book-1|Stone Stairs|drafting|Amber light|Keep warm|ghostwriter-cover://p/b"
    );
    expect(
      bookTitleStudioFingerprint({
        ...book,
        cover: { ...book.cover, notes: "Keep warm" }
      })
    ).toBe(bookTitleStudioFingerprint(book));
    expect(
      bookTitleStudioFingerprint({
        ...book,
        title: "Stone Stairs Revised"
      })
    ).not.toBe(bookTitleStudioFingerprint(book));
  });

  it("builds image prompts from title and art direction", () => {
    const generic = buildBookCoverImagePrompt({ title: "", concept: "" });
    expect(generic).toContain("Hardcover book cover illustration.");
    expect(generic).not.toContain("copyrighted");

    const withConcept = buildBookCoverImagePrompt({
      title: "Harry Potter and the Philosopher's Stone",
      concept: "Amber light on stone stairs"
    });
    expect(withConcept).toContain("Harry Potter and the Philosopher's Stone");
    expect(withConcept).toContain("Amber light on stone stairs");
  });

  it("derives initials from book titles", () => {
    expect(bookCoverInitials("")).toBe("?");
    expect(bookCoverInitials("Steps")).toBe("ST");
    expect(bookCoverInitials("Harry Potter and the Chamber of Secrets")).toBe(
      "HS"
    );
  });

  it("shortens trail labels for series crumbs", () => {
    expect(bookCoverTrailLabel("Harry Potter and the Deathly Hallows")).toBe(
      "Deathly Hallows"
    );
    expect(bookCoverTrailLabel("Short")).toBe("Short");
  });

  it("picks stable placeholder colors from the title", () => {
    const first = bookCoverPlaceholderColors("Book of Steps");
    const second = bookCoverPlaceholderColors("Book of Steps");
    const other = bookCoverPlaceholderColors("Another Title");
    expect(first).toEqual(second);
    expect(first.top).toMatch(/^#/);
    expect(first.bottom).toMatch(/^#/);
    expect(other).not.toEqual(first);
  });
});
