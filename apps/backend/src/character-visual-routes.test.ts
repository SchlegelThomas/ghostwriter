import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE_PROJECT_ID,
  buildCharacterVisualObjectKey,
  type CaptureObjectStoragePort
} from "@ghostwriter/core";
import {
  clearCharacterVisualJobsForTests,
  settleCharacterVisualJobsForTests
} from "./character-visual-jobs.js";
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
const KNOWLEDGE_ID = "knowledge-mara-venn";
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

const fakeImage: ScenePartnerImageGenerator = async () => ({
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
    scenePartnerGenerateImage: options?.scenePartnerGenerateImage ?? fakeImage,
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
  await settleCharacterVisualJobsForTests();
  clearCharacterVisualJobsForTests();
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function pollVisualJob(
  app: Awaited<ReturnType<typeof openSeededApp>>["app"],
  jobId: string
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/jobs/${jobId}`,
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
  throw new Error(`Character visual job ${jobId} did not settle.`);
}

describe("character visual routes", () => {
  it("applies a PNG data URI to R2 and appends a locator visual", async () => {
    const { app, objectStorage } = await openSeededApp();

    const response = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          previewDataUri: TINY_PNG_DATA_URI,
          alt: "Mara portrait",
          source: "upload"
        })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.visual.alt).toBe("Mara portrait");
    expect(body.visual.source).toBe("upload");
    expect(body.visual.url).toContain("https://ghostwriter.character/");
    expect(body.visual.url).not.toContain("data:");
    expect(body.visuals).toHaveLength(1);
    expect(
      objectStorage.hasObject(
        buildCharacterVisualObjectKey(PROJECT, KNOWLEDGE_ID, body.visual.id)
      )
    ).toBe(true);

    const navigator = await app.request(`/api/projects/${PROJECT}/navigator`, {
      method: "GET",
      headers: originHeaders("GET")
    });
    expect(navigator.status).toBe(200);
    const navigatorBody = await navigator.json();
    const knowledge = navigatorBody.storyKnowledge.find(
      (candidate: { id: string }) => candidate.id === KNOWLEDGE_ID
    );
    expect(knowledge?.visuals?.[0]?.id).toBe(body.visual.id);
  });

  it("downloads via hermetic data URI from getObjectBytes", async () => {
    const { app } = await openSeededApp();
    const applied = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          previewDataUri: TINY_PNG_DATA_URI,
          alt: "Downloadable portrait",
          source: "generated"
        })
      }
    );
    expect(applied.status).toBe(201);
    const appliedBody = await applied.json();

    const response = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/${appliedBody.visual.id}/download`,
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

  it("returns 503 when visual storage is unavailable on apply", async () => {
    const { app } = await openSeededApp({
      objectStorage: createUnavailableCaptureObjectStorage()
    });

    const response = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          previewDataUri: TINY_PNG_DATA_URI,
          alt: "Unavailable",
          source: "upload"
        })
      }
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(
      "CHARACTER_VISUAL_STORAGE_UNAVAILABLE"
    );
  });

  it("starts an async visual job and polls until options are ready", async () => {
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
    await configureOpenAi(app);

    const started = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/${KNOWLEDGE_ID}/visuals/jobs`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ count: 3 })
      }
    );
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    expect(startedBody.status).toBe("queued");
    expect(typeof startedBody.jobId).toBe("string");

    const ready = await pollVisualJob(app, startedBody.jobId);
    expect(ready.status).toBe("ready");
    expect(ready.options).toHaveLength(3);
    expect(ready.basePrompt).toContain("Mara Venn");
    expect(JSON.stringify(ready)).not.toContain(OPENAI_KEY);
  });

  it("requires an existing knowledge record", async () => {
    const { app } = await openSeededApp();
    const missing = await app.request(
      `/api/projects/${PROJECT}/story-knowledge/knowledge_missing/visuals/apply`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          previewDataUri: TINY_PNG_DATA_URI,
          alt: "Missing",
          source: "upload"
        })
      }
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("STORY_KNOWLEDGE_NOT_FOUND");
  });
});
