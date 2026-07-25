import type { BookId, ChapterId, ProjectNavigator } from "@ghostwriter/core";
import type { CanvasScenePlacementInput } from "./api.js";

export type ManuscriptHandoffPlacement = CanvasScenePlacementInput;

export type ManuscriptHandoffChoice = Readonly<{
  key: string;
  label: string;
}>;

export type ManuscriptHandoffValidation =
  | Readonly<{ valid: true; placement: ManuscriptHandoffPlacement }>
  | Readonly<{ valid: false }>;

export function encodeManuscriptHandoffKey(
  bookId: BookId,
  target: "unassigned" | ChapterId
): string {
  return `${bookId}::${target === "unassigned" ? "unassigned" : target}`;
}

export function decodeManuscriptHandoffKey(
  key: string
): Readonly<{ bookId: string; chapterId: string }> | undefined {
  const separator = key.indexOf("::");
  if (separator <= 0 || separator >= key.length - 1) {
    return undefined;
  }
  const bookId = key.slice(0, separator);
  const chapterId = key.slice(separator + 2);
  if (bookId.length === 0 || chapterId.length === 0) {
    return undefined;
  }
  return { bookId, chapterId };
}

export function listManuscriptHandoffChoices(
  project: ProjectNavigator
): readonly ManuscriptHandoffChoice[] {
  return project.books
    .filter((book) => book.archivedAt === undefined)
    .flatMap((book) => [
      {
        key: encodeManuscriptHandoffKey(book.id, "unassigned"),
        label: `${book.title} · Unassigned`
      },
      ...book.parts.flatMap((part) =>
        part.chapters.map((chapter) => ({
          key: encodeManuscriptHandoffKey(book.id, chapter.id),
          label: `${book.title} · ${chapter.title}`
        }))
      )
    ]);
}

export function resolveManuscriptHandoffPlacement(
  project: ProjectNavigator,
  key: string
): ManuscriptHandoffPlacement | undefined {
  const decoded = decodeManuscriptHandoffKey(key);
  if (decoded === undefined) {
    return undefined;
  }
  const book = project.books.find(
    (candidate) =>
      candidate.id === decoded.bookId && candidate.archivedAt === undefined
  );
  if (book === undefined) {
    return undefined;
  }
  if (decoded.chapterId === "unassigned") {
    return { kind: "unassigned", bookId: book.id };
  }
  const chapter = book.parts
    .flatMap((part) => part.chapters)
    .find((candidate) => candidate.id === decoded.chapterId);
  if (chapter === undefined) {
    return undefined;
  }
  return { kind: "chapter", bookId: book.id, chapterId: chapter.id };
}

export function validateManuscriptHandoffSelection(
  project: ProjectNavigator,
  key: string
): ManuscriptHandoffValidation {
  const placement = resolveManuscriptHandoffPlacement(project, key);
  if (placement === undefined) {
    return { valid: false };
  }
  return { valid: true, placement };
}

/** Append-at-end placement in canonical Draft story order (0 = first scene). */
export function canonicalIndexForCanvasHandoff(
  project: ProjectNavigator,
  placement: ManuscriptHandoffPlacement
): number | undefined {
  let canonicalIndex = 0;
  for (const book of project.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        if (
          placement.kind === "chapter" &&
          placement.bookId === book.id &&
          placement.chapterId === chapter.id
        ) {
          const position = placement.position ?? chapter.scenes.length;
          return Number.isSafeInteger(position) &&
            position >= 0 &&
            position <= chapter.scenes.length
            ? canonicalIndex + position
            : undefined;
        }
        canonicalIndex += chapter.scenes.length;
      }
    }
    if (placement.kind === "unassigned" && placement.bookId === book.id) {
      const position = placement.position ?? book.unassignedScenes.length;
      return Number.isSafeInteger(position) &&
        position >= 0 &&
        position <= book.unassignedScenes.length
        ? canonicalIndex + position
        : undefined;
    }
    canonicalIndex += book.unassignedScenes.length;
  }
  return undefined;
}

export function manuscriptHandoffStoryOrderHintText(
  project: ProjectNavigator,
  key: string
): string {
  const placement = resolveManuscriptHandoffPlacement(project, key);
  if (placement === undefined) {
    return "";
  }
  const canonicalIndex = canonicalIndexForCanvasHandoff(project, placement);
  return canonicalIndex === undefined ? "" : String(canonicalIndex);
}
