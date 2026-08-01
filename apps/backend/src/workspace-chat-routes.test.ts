import { afterEach, describe, expect, it } from "vitest";
import { createFakeStructuredCompletionProvider } from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_NAVIGATOR, BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import type { OpenAiCompletionProviderFactory } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";
import { assembleWorkspaceChatContext } from "./workspace-chat-routes.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const OPENAI_KEY = "sk-valid-openai-key-1234567890";
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;

function originHeaders(): Record<string, string> {
  return {
    origin: TEST_ORIGIN,
    "content-type": "application/json"
  };
}

function fakeWorkspaceChatFactory(): OpenAiCompletionProviderFactory {
  return () =>
    createFakeStructuredCompletionProvider((input) => ({
      output: {
        reply: `Agent reply with context:\n${input.inputText}`
      }
    }));
}

async function openSeededApp(
  options?: Readonly<{
    kekConfig?: ReturnType<typeof createTestProviderKekRuntimeConfig> | undefined;
    openAiCompletionProviderFactory?: OpenAiCompletionProviderFactory;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: options?.kekConfig,
    openAiCompletionProviderFactory: options?.openAiCompletionProviderFactory
  });
}

async function configureOpenAi(
  app: Awaited<ReturnType<typeof openSeededApp>>["app"]
) {
  const saved = await app.request("/api/me/provider/openai", {
    method: "PUT",
    headers: originHeaders(),
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

describe("assembleWorkspaceChatContext", () => {
  it("includes project totals and selection titles", () => {
    const book = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!;
    const part = book.parts[0]!;
    const chapter = part.chapters[0]!;
    const scene = chapter.scenes[0]!;
    const text = assembleWorkspaceChatContext({
      navigator: BELLWETHER_FIXTURE_NAVIGATOR,
      selection: {
        kind: "scene",
        bookId: book.id,
        partId: part.id,
        chapterId: chapter.id,
        sceneId: scene.id
      }
    });
    expect(text).toContain(BELLWETHER_FIXTURE_NAVIGATOR.title);
    expect(text).toContain(`scene="${scene.title}"`);
    expect(text).toContain(`chapter="${chapter.title}"`);
    expect(text).toContain(`book="${book.title}"`);
  });
});

describe("POST /api/workspace/chat", () => {
  it("keeps navigator.read deterministic tool path", async () => {
    const { app } = await openSeededApp();
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "project.navigator.read",
        projectId: PROJECT,
        mode: "agent",
        effort: "fast"
      })
    });
    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({
      reply: expect.stringContaining(BELLWETHER_FIXTURE_NAVIGATOR.title),
      mode: "agent",
      effort: "fast"
    });
  });

  it("returns a friendly no-key reply without capability matching walls", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "What is this project about?",
        projectId: PROJECT
      })
    });
    expect(chat.status).toBe(200);
    const body = await chat.json();
    expect(body).toMatchObject({
      reply: expect.stringContaining("Settings"),
      code: "PROVIDER_NOT_CONFIGURED",
      mode: "chat",
      model: "gpt-4.1",
      effort: "standard"
    });
    expect(String(body.reply)).not.toContain("Matching capabilities");
    expect(String(body.reply)).not.toContain("Tool-only chat");
  });

  it("returns BYOK reply containing assembled project context", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeWorkspaceChatFactory()
    });
    await configureOpenAi(app);
    const book = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!;
    const part = book.parts[0]!;
    const chapter = part.chapters[0]!;
    const scene = chapter.scenes[0]!;
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "Summarize the open manuscript focus.",
        projectId: PROJECT,
        mode: "plan",
        model: "gpt-4.1-mini",
        effort: "high",
        selection: {
          kind: "scene",
          bookId: book.id,
          partId: part.id,
          chapterId: chapter.id,
          sceneId: scene.id
        }
      })
    });
    expect(chat.status).toBe(200);
    const body = await chat.json();
    expect(body).toMatchObject({
      mode: "plan",
      model: "gpt-4.1-mini",
      effort: "high"
    });
    expect(String(body.reply)).toContain(BELLWETHER_FIXTURE_NAVIGATOR.title);
    expect(String(body.reply)).toContain(`scene="${scene.title}"`);
    expect(String(body.reply)).not.toContain("Matching capabilities");
  });

  it("accepts chat mode on free-text turns", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeWorkspaceChatFactory()
    });
    await configureOpenAi(app);
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "Any ideas for the next scene?",
        projectId: PROJECT,
        mode: "chat"
      })
    });
    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({
      mode: "chat",
      reply: expect.stringContaining("Writer message:")
    });
  });
});
