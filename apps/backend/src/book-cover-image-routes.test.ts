import { afterEach, describe, expect, it } from "vitest";
import { aiDiagnostic } from "@ghostwriter/ai";
import {
  BELLWETHER_FIXTURE_PROJECT_ID,
  buildBookCoverLocatorUrl,
  buildBookCoverObjectKey,
  type CaptureObjectStoragePort
} from "@ghostwriter/core";
import {
  clearBookCoverImageJobsForTests,
  settleBookCoverImageJobsForTests
} from "./book-cover-image-jobs.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import { createUnavailableCaptureObjectStorage } from "./r2-capture-object-storage.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const OPENAI_KEY = "sk-valid-openai-key-1234567890";
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const BOOK_ID = "book-signal-at-bellwether";
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_ORIGIN,
        "content-type": "application/json"
      };
}

const fakeCoverImage: ScenePartnerImageGenerator = async () => ({
  ok: true as const,
  b64Json: TINY_PNG_B64,
  dataUri: TINY_PNG_DATA_URI
});

async function openSeededApp(
  options?: Readonly<{
    scenePartnerGenerateImage?: ScenePartnerImageGenerator;
    objectStorage?: CaptureObjectStoragePort;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig(),
    scenePartnerGenerateImage:
      options?.scenePartnerGenerateImage ?? fakeCoverImage,
    ...(options?.objectStorage === undefined
      ? {}
      : { objectStorage: options.objectStorage })
  });
}

async function configureOpenAi(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  const saved = await app.request("/api/me/provider/openai", {
    method: "PUT",
    headers: originHeaders("PUT"),
    body: JSON.stringify({ apiKey: OPENAI_KEY })
  });
  expect(saved.status).toBe(200);
}

afterEach(async () => {
  await settleBookCoverImageJobsForTests();
  clearBookCoverImageJobsForTests();
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function pollCoverImageJob(
  app: Awaited<ReturnType<typeof openSeededApp>>["app"],
  jobId: string,
  bookId = BOOK_ID
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.request(
      `/api/projects/${PROJECT}/books/${bookId}/cover/images/jobs/${jobId}`,
      {
        method: "GET",
        headers: originHeaders("GET")
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    if (body.status === "ready" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Cover image job ${jobId} did not settle.`);
}

describe("book cover image routes", () => {
  it("previews a BYOK cover without persisting", async () => {
    const { app, objectStorage } = await openSeededApp();
    await configureOpenAi(app);

    const response = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Fogbound lighthouse hardcover" })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.previewUrl).toBe(TINY_PNG_DATA_URI);
    expect(body.alt).toBe("Proposed book cover");
    expect(body.prompt).toBe("Fogbound lighthouse hardcover");
    expect(
      objectStorage.hasObject(buildBookCoverObjectKey(PROJECT, BOOK_ID))
    ).toBe(false);
    expect(JSON.stringify(body)).not.toContain(OPENAI_KEY);
  });

  it("previews with an injected generator without a saved OpenAI key", async () => {
    const { app } = await openSeededApp();
    const response = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Placeholder hardcover" })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.previewUrl).toBe(TINY_PNG_DATA_URI);
  });

  it("applies a preview data URI to object storage and persists the locator", async () => {
    const { app, objectStorage } = await openSeededApp();

    const response = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ previewDataUri: TINY_PNG_DATA_URI })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const locator = buildBookCoverLocatorUrl(PROJECT, BOOK_ID);
    expect(body.imageUrl).toBe(locator);
    expect(body.cover.imageUrl).toBe(locator);
    expect(body.cover.imageUrl).not.toContain("data:");
    expect(
      objectStorage.hasObject(buildBookCoverObjectKey(PROJECT, BOOK_ID))
    ).toBe(true);

    const navigator = await app.request(`/api/projects/${PROJECT}/navigator`, {
      method: "GET",
      headers: originHeaders("GET")
    });
    expect(navigator.status).toBe(200);
    const navigatorBody = await navigator.json();
    const book = navigatorBody.books.find(
      (candidate: { id: string }) => candidate.id === BOOK_ID
    );
    expect(book?.cover?.imageUrl).toBe(locator);
  });

  it("downloads via hermetic data URI from getObjectBytes", async () => {
    const { app } = await openSeededApp();
    const applied = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ previewDataUri: TINY_PNG_DATA_URI })
      }
    );
    expect(applied.status).toBe(201);

    const response = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/download`,
      {
        method: "GET",
        headers: originHeaders("GET")
      }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.download.url).toBe(TINY_PNG_DATA_URI);
    expect(typeof body.download.expiresAt).toBe("string");
  });

  it("returns 503 when cover storage is unavailable on apply", async () => {
    const { app } = await openSeededApp({
      objectStorage: createUnavailableCaptureObjectStorage()
    });

    const response = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ previewDataUri: TINY_PNG_DATA_URI })
      }
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("COVER_STORAGE_UNAVAILABLE");
  });

  it("requires an existing book and rejects both prompt and preview", async () => {
    const { app } = await openSeededApp();
    await configureOpenAi(app);

    const missingBook = await app.request(
      `/api/projects/${PROJECT}/books/book_missing/cover/images`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Unused" })
      }
    );
    expect(missingBook.status).toBe(404);
    expect((await missingBook.json()).code).toBe("BOOK_NOT_FOUND");

    const invalidApply = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          prompt: "Double spend",
          previewDataUri: TINY_PNG_DATA_URI
        })
      }
    );
    expect(invalidApply.status).toBe(400);
  });

  it("starts an async cover job and polls until three options are ready", async () => {
    let call = 0;
    const uniqueFake: ScenePartnerImageGenerator = async ({ prompt }) => {
      call += 1;
      return {
        ok: true as const,
        b64Json: TINY_PNG_B64,
        dataUri: `${TINY_PNG_DATA_URI}#${call}-${prompt.length}`
      };
    };
    const { app } = await openSeededApp({
      scenePartnerGenerateImage: uniqueFake
    });

    const started = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/jobs`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          prompt: "Fogbound lighthouse hardcover",
          refinement: "more gold foil"
        })
      }
    );
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    expect(startedBody.status).toBe("queued");
    expect(typeof startedBody.jobId).toBe("string");

    const ready = await pollCoverImageJob(app, startedBody.jobId);
    expect(ready.status).toBe("ready");
    expect(ready.basePrompt).toBe(
      "Fogbound lighthouse hardcover\nIteration notes: more gold foil"
    );
    expect(ready.options).toHaveLength(3);
    for (const option of ready.options) {
      expect(option.previewUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(typeof option.id).toBe("string");
      expect(typeof option.prompt).toBe("string");
      expect(typeof option.variationIndex).toBe("number");
    }
    expect(JSON.stringify(ready)).not.toContain(OPENAI_KEY);
  });

  it("returns 404 when polling a job against the wrong book", async () => {
    const { app } = await openSeededApp();
    const started = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/jobs`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Scoped hardcover" })
      }
    );
    expect(started.status).toBe(202);
    const { jobId } = await started.json();

    const wrongBook = await app.request(
      `/api/projects/${PROJECT}/books/book_missing/cover/images/jobs/${jobId}`,
      {
        method: "GET",
        headers: originHeaders("GET")
      }
    );
    expect(wrongBook.status).toBe(404);
    expect((await wrongBook.json()).code).toBe("BOOK_NOT_FOUND");
  });

  it("can become ready when one injected variation fails", async () => {
    let calls = 0;
    const flakyFake: ScenePartnerImageGenerator = async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, diagnostic: aiDiagnostic("refusal") };
      }
      return {
        ok: true as const,
        b64Json: TINY_PNG_B64,
        dataUri: TINY_PNG_DATA_URI
      };
    };
    const { app } = await openSeededApp({
      scenePartnerGenerateImage: flakyFake
    });

    const started = await app.request(
      `/api/projects/${PROJECT}/books/${BOOK_ID}/cover/images/jobs`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Partial success hardcover", count: 3 })
      }
    );
    expect(started.status).toBe(202);
    const { jobId } = await started.json();
    const ready = await pollCoverImageJob(app, jobId);
    expect(ready.status).toBe("ready");
    expect(ready.options.length).toBeGreaterThanOrEqual(1);
    expect(ready.options.length).toBeLessThan(3);
  });
});
