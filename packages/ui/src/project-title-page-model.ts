import type { BookId, BookStatus } from "@ghostwriter/core";
import { ghostwriterTheme } from "./theme.js";

const { colors } = ghostwriterTheme;

/** Warm theme pairs for cover placeholders — no generic AI purple. */
const PLACEHOLDER_PAIRS: readonly (readonly [string, string])[] = [
  [colors.amberSoft, colors.wash],
  [colors.accentSoft, colors.canvas],
  [colors.greenSoft, colors.wash],
  [colors.blueSoft, colors.canvas],
  [colors.wash, colors.amberSoft],
  [colors.canvas, colors.accentSoft]
];

export function bookCoverInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** Short crumb label — strip common series prefixes when present. */
export function bookCoverTrailLabel(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "Book";
  const withoutSeries = trimmed
    .replace(/^harry\s+potter\s+and\s+the\s+/iu, "")
    .replace(/^the\s+/iu, "");
  if (withoutSeries.length > 0 && withoutSeries.length < trimmed.length) {
    return withoutSeries;
  }
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 27)}…`;
}

/**
 * Build an Images prompt from the writer's title + art direction.
 * Content rights stay with the writer — we do not sanitize franchise references.
 */
export function buildBookCoverImagePrompt(input: Readonly<{
  title: string;
  concept: string;
}>): string {
  const title = input.title.trim();
  const concept = input.concept.trim();
  const art =
    concept.length > 0
      ? concept
      : "Atmospheric literary hardcover with a strong silhouette, rich print colors, and a clear title band";
  return [
    "Hardcover book cover illustration.",
    title.length > 0 ? `Book title: ${title}.` : "",
    `Art direction: ${art}.`,
    "Leave a clean area for title lettering.",
    "No watermarks or barcodes."
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * Stable server-content key for Title Page drafts.
 * Re-sync drafts only when this changes — not on every navigator object identity churn.
 */
export function bookTitleStudioFingerprint(book: Readonly<{
  id: BookId;
  title: string;
  status: BookStatus;
  cover?: Readonly<{
    concept?: string;
    notes?: string;
    imageUrl?: string;
  }>;
}>): string {
  return [
    book.id,
    book.title,
    book.status,
    book.cover?.concept ?? "",
    book.cover?.notes ?? "",
    book.cover?.imageUrl ?? ""
  ].join("|");
}

export function bookCoverPlaceholderColors(title: string): Readonly<{
  top: string;
  bottom: string;
}> {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  }
  const [top, bottom] = PLACEHOLDER_PAIRS[hash % PLACEHOLDER_PAIRS.length]!;
  return { top, bottom };
}
