import { afterEach, describe, expect, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import type { OpenAiCompletionProviderFactory } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const OPENAI_KEY = "sk-valid-openai-key-1234567890";
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;

const scenePartnerTurnPayload = Object.freeze({
  schemaId: "scene-partner-turn-v1" as const,
  thinkingSteps: Object.freeze(["Reading idea", "Scanning scenes"]),
  assistantMessage: "This idea feels ready for a new scene.",
  phase: "new-scene" as const,
  matchedSceneId: null,
  proseDraft: "Soft light holds for a breath.",
  actions: Object.freeze(["apply-new-scene", "propose-image"] as const),
  imagePrompt: "Quiet harbor lanterns"
});

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_ORIGIN,
        "content-type": "application/json"
      };
}

function fakeScenePartnerCompletionFactory(): OpenAiCompletionProviderFactory {
  return () =>
    createFakeStructuredCompletionProvider((input) => {
      if (input.outputSchema.name === "scene_partner_turn_v1") {
        return { output: scenePartnerTurnPayload };
      }
      return {
        output: {
          schemaId: "capture-reflection-v1",
          summary: "unused",
          questions: ["unused?"],
          possibleStoryJobs: [{ label: "Cold open", rationale: "unused" }]
        }
      };
    });
}

async function openSeededApp(
  options?: Readonly<{
    callsDisabled?: boolean;
    openAiCompletionProviderFactory?: OpenAiCompletionProviderFactory;
    scenePartnerGenerateImage?: ScenePartnerImageGenerator;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig(),
    callsDisabled: options?.callsDisabled,
    openAiCompletionProviderFactory: options?.openAiCompletionProviderFactory,
    ...(options?.scenePartnerGenerateImage === undefined
      ? {}
      : { scenePartnerGenerateImage: options.scenePartnerGenerateImage })
  });
}

async function createReadyCapture(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  const created = await app.request(`/api/projects/${PROJECT}/captures`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: JSON.stringify({ sourceModality: "text" })
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json();
  return createdBody.head.captureId as string;
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
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

describe("scene partner routes", () => {
  it("runs a live turn with the fake structured provider", async () => {
    const { app } = await openSeededApp({
      openAiCompletionProviderFactory: fakeScenePartnerCompletionFactory()
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);

    const response = await app.request(
      `/api/projects/${PROJECT}/captures/${captureId}/scene-partner/turns`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          ideaProse: "Fog presses the harbor glass before the first arrival.",
          scenes: [
            {
              id: "scene_harbor",
              title: "Harbor lanterns",
              label: "Book · Harbor lanterns"
            }
          ],
          messages: []
        })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.turn.phase).toBe("new-scene");
    expect(body.turn.thinkingSteps).toEqual(["Reading idea", "Scanning scenes"]);
    expect(body.turn.actions).toEqual(["apply-new-scene", "propose-image"]);
    expect(body.turn.proseDraft).toContain("Soft light");
    expect(JSON.stringify(body)).not.toContain(OPENAI_KEY);
  });

  it("generates an image via the injectable helper", async () => {
    const { app } = await openSeededApp({
      openAiCompletionProviderFactory: fakeScenePartnerCompletionFactory(),
      scenePartnerGenerateImage: async () => ({
        ok: true as const,
        b64Json: "aGVsbG8=",
        dataUri: "data:image/png;base64,aGVsbG8="
      })
    });
    await configureOpenAi(app);
    const captureId = await createReadyCapture(app);

    const response = await app.request(
      `/api/projects/${PROJECT}/captures/${captureId}/scene-partner/images`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({ prompt: "Quiet harbor lanterns" })
      }
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.alt).toBe("Proposed scene image");
    expect(body.prompt).toBe("Quiet harbor lanterns");
    expect(body.url).toContain("data:image/png;base64,");
    expect(JSON.stringify(body)).not.toContain(OPENAI_KEY);
  });

  it("requires a configured key and an existing capture", async () => {
    const { app } = await openSeededApp({
      openAiCompletionProviderFactory: fakeScenePartnerCompletionFactory()
    });
    const captureId = await createReadyCapture(app);

    const missingKey = await app.request(
      `/api/projects/${PROJECT}/captures/${captureId}/scene-partner/turns`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          ideaProse: "A thin spark.",
          scenes: [],
          messages: []
        })
      }
    );
    expect(missingKey.status).toBe(404);
    expect((await missingKey.json()).code).toBe("PROVIDER_NOT_CONFIGURED");

    await configureOpenAi(app);
    const missingCapture = await app.request(
      `/api/projects/${PROJECT}/captures/capture_missing/scene-partner/turns`,
      {
        method: "POST",
        headers: originHeaders("POST"),
        body: JSON.stringify({
          ideaProse: "A thin spark.",
          scenes: [],
          messages: []
        })
      }
    );
    expect(missingCapture.status).toBe(404);
    expect((await missingCapture.json()).code).toBe("CAPTURE_NOT_FOUND");
  });
});
