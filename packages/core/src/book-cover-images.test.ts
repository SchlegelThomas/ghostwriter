import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./domain.js";
import {
  BOOK_COVER_LOCATOR_ORIGIN,
  buildBookCoverLocatorUrl,
  buildBookCoverObjectKey,
  decodePngDataUri,
  parseBookCoverLocatorUrl
} from "./book-cover-images.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("book cover image locators", () => {
  it("builds object keys and locator URLs that round-trip through parse", () => {
    const projectId = "project-bellwether-cycle";
    const bookId = "book-signal-at-bellwether";

    expect(buildBookCoverObjectKey(projectId, bookId)).toBe(
      "projects/project-bellwether-cycle/books/book-signal-at-bellwether/cover.png"
    );

    const locator = buildBookCoverLocatorUrl(projectId, bookId);
    expect(locator.startsWith(`${BOOK_COVER_LOCATOR_ORIGIN}/`)).toBe(true);
    expect(parseBookCoverLocatorUrl(locator)).toEqual({ projectId, bookId });
  });

  it("rejects non-locator URLs", () => {
    expect(parseBookCoverLocatorUrl("https://cdn.example.com/cover.png")).toBeUndefined();
    expect(
      parseBookCoverLocatorUrl(`${BOOK_COVER_LOCATOR_ORIGIN}/projects/only-one`)
    ).toBeUndefined();
    expect(parseBookCoverLocatorUrl("not-a-url")).toBeUndefined();
  });
});

describe("decodePngDataUri", () => {
  it("decodes a PNG data URI", () => {
    const bytes = decodePngDataUri(`data:image/png;base64,${TINY_PNG_B64}`);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });

  it("rejects non-PNG data URIs and empty payloads", () => {
    expect(() => decodePngDataUri("data:image/jpeg;base64,aaaa")).toThrow(
      DomainValidationError
    );
    expect(() => decodePngDataUri("data:image/png;base64,")).toThrow(DomainValidationError);
    expect(() => decodePngDataUri("data:image/png;base64,!!!")).toThrow(
      DomainValidationError
    );
  });
});
