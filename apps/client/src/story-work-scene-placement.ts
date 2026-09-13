import type { ProjectNavigatorBook } from "@ghostwriter/core";
import type { SceneReviewPlacementChoice } from "@ghostwriter/ui";

/** Manuscript choices come from canonical structure, never Canvas coordinates. */
export function storyWorkScenePlacementChoices(
  books: readonly ProjectNavigatorBook[]
): readonly SceneReviewPlacementChoice[] {
  return books.filter((book) => book.archivedAt === undefined).flatMap((book) => [
    ...book.parts.flatMap((part) => part.chapters.map((chapter) => ({
      id: `chapter:${book.id}:${chapter.id}`,
      label: `${book.title} · ${part.title} · ${chapter.title}`,
      description: "Append to this chapter's manuscript order.",
      manuscriptPlacement: { kind: "chapter" as const, bookId: book.id, chapterId: chapter.id }
    }))),
    {
      id: `unassigned:${book.id}`,
      label: `${book.title} · Unassigned scenes`,
      description: "Keep this scene outside a chapter until you place it.",
      manuscriptPlacement: { kind: "unassigned" as const, bookId: book.id }
    }
  ]);
}
