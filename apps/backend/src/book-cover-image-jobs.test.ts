import { afterEach, describe, expect, it } from "vitest";
import { aiDiagnostic } from "@ghostwriter/ai";
import {
  buildBookCoverVariationPrompts,
  clearBookCoverImageJobsForTests,
  composeBookCoverImagePrompt,
  createBookCoverImageJob,
  getBookCoverImageJob,
  runBookCoverImageJob,
  toBookCoverImageJobSnapshot,
  type BookCoverImageGenerator
} from "./book-cover-image-jobs.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

afterEach(() => {
  clearBookCoverImageJobsForTests();
});

describe("book cover image jobs", () => {
  it("clamps option count and composes refinement notes on the server", () => {
    expect(buildBookCoverVariationPrompts("Base", 1)).toHaveLength(2);
    expect(buildBookCoverVariationPrompts("Base", 9)).toHaveLength(4);
    expect(
      createBookCoverImageJob({
        accountId: "account_a",
        projectId: "project_a",
        bookId: "book_a",
        basePrompt: "Base"
      }).count
    ).toBe(3);
    expect(composeBookCoverImagePrompt("Fog cover", "more gold foil")).toBe(
      "Fog cover\nIteration notes: more gold foil"
    );
  });

  it("returns undefined for mismatched account/project/book and purges by TTL", () => {
    let nowMs = Date.parse("2026-07-25T12:00:00.000Z");
    const now = () => new Date(nowMs);
    const job = createBookCoverImageJob({
      accountId: "account_a",
      projectId: "project_a",
      bookId: "book_a",
      basePrompt: "Base",
      now
    });

    expect(
      getBookCoverImageJob({
        jobId: job.id,
        accountId: "account_b",
        projectId: "project_a",
        bookId: "book_a",
        now
      })
    ).toBeUndefined();

    nowMs += 31 * 60 * 1000;
    expect(
      getBookCoverImageJob({
        jobId: job.id,
        accountId: "account_a",
        projectId: "project_a",
        bookId: "book_a",
        now
      })
    ).toBeUndefined();
  });

  it("runs variations in parallel and becomes ready when any option succeeds", async () => {
    let calls = 0;
    const generateImage: BookCoverImageGenerator = async ({ prompt }) => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, diagnostic: aiDiagnostic("refusal") };
      }
      return {
        ok: true as const,
        b64Json: TINY_PNG_B64,
        dataUri: `${TINY_PNG_DATA_URI}#${prompt.length}`
      };
    };

    const job = createBookCoverImageJob({
      accountId: "account_a",
      projectId: "project_a",
      bookId: "book_a",
      basePrompt: "Lighthouse hardcover",
      count: 3
    });

    await runBookCoverImageJob({
      jobId: job.id,
      generateImage,
      apiKey: "injected-image-generator",
      size: "1024x1536"
    });

    const ready = getBookCoverImageJob({
      jobId: job.id,
      accountId: "account_a",
      projectId: "project_a",
      bookId: "book_a"
    });
    expect(ready?.status).toBe("ready");
    expect(ready?.options).toHaveLength(2);
    const snapshot = toBookCoverImageJobSnapshot(ready!);
    expect(snapshot.options).toHaveLength(2);
    expect(snapshot.error).toBeUndefined();
  });

  it("fails the job when every variation fails and maps moderation", async () => {
    const generateImage: BookCoverImageGenerator = async () => ({
      ok: false,
      diagnostic: aiDiagnostic("refusal")
    });
    const job = createBookCoverImageJob({
      accountId: "account_a",
      projectId: "project_a",
      bookId: "book_a",
      basePrompt: "Blocked franchise",
      count: 2
    });

    await runBookCoverImageJob({
      jobId: job.id,
      generateImage,
      apiKey: "injected-image-generator"
    });

    const failed = getBookCoverImageJob({
      jobId: job.id,
      accountId: "account_a",
      projectId: "project_a",
      bookId: "book_a"
    });
    expect(failed?.status).toBe("failed");
    expect(failed?.error?.code).toBe("COVER_IMAGE_MODERATION_BLOCKED");
    expect(toBookCoverImageJobSnapshot(failed!).options).toBeUndefined();
  });
});
