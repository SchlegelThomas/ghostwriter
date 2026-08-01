import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeStructuredCompletionProvider,
  createFakeToolLoopProvider,
  type ToolLoopCompletionInput,
  type createToolLoopProvider
} from "@ghostwriter/ai";
import { BELLWETHER_FIXTURE_NAVIGATOR, BELLWETHER_FIXTURE_PROJECT_ID } from "@ghostwriter/core";
import type { OpenAiCompletionProviderFactory } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";
import {
  assembleWorkspaceChatContext,
  buildWorkspaceChatInputText,
  formatWorkspaceChatAttachmentsContext,
  workspaceChatRequestSchema
} from "./workspace-chat-routes.js";

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
    workspaceChatCreateToolLoopProvider?: typeof createToolLoopProvider;
  }>
) {
  return createSeededBackendApp(undefined, {
    kekConfig: options?.kekConfig,
    openAiCompletionProviderFactory: options?.openAiCompletionProviderFactory,
    ...(options?.workspaceChatCreateToolLoopProvider === undefined
      ? {}
      : {
          workspaceChatCreateToolLoopProvider:
            options.workspaceChatCreateToolLoopProvider
        })
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

describe("buildWorkspaceChatInputText", () => {
  it("includes bounded prior turns as non-authoritative context", () => {
    const text = buildWorkspaceChatInputText({
      message: "Try again with more detail",
      contextText: "Project: Bellwether",
      priorTurns: [
        { role: "user", body: "Outline act one" },
        { role: "assistant", body: "Here is a draft outline." }
      ]
    });
    expect(text).toContain("Recent conversation (non-authoritative):");
    expect(text).toContain("Writer: Outline act one");
    expect(text).toContain("Assistant: Here is a draft outline.");
    expect(text).toContain("Writer message:");
    expect(text).toContain("Try again with more detail");
  });
});

describe("workspaceChatRequestSchema attachments", () => {
  it("accepts bounded image attachments", () => {
    const parsed = workspaceChatRequestSchema.safeParse({
      message: "See this cover",
      attachments: [
        {
          kind: "image",
          name: "cover.png",
          mimeType: "image/png",
          byteLength: 1024,
          dataBase64: "aGVsbG8="
        }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects too many attachments", () => {
    const parsed = workspaceChatRequestSchema.safeParse({
      message: "Too many",
      attachments: [
        { kind: "image", name: "a.png", mimeType: "image/png", byteLength: 1 },
        { kind: "image", name: "b.png", mimeType: "image/png", byteLength: 1 },
        { kind: "image", name: "c.png", mimeType: "image/png", byteLength: 1 },
        { kind: "image", name: "d.png", mimeType: "image/png", byteLength: 1 }
      ]
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects video inline binary", () => {
    const parsed = workspaceChatRequestSchema.safeParse({
      message: "Clip",
      attachments: [
        {
          kind: "video",
          name: "clip.mp4",
          mimeType: "video/mp4",
          byteLength: 1000,
          dataBase64: "abc"
        }
      ]
    });
    expect(parsed.success).toBe(false);
  });
});

describe("formatWorkspaceChatAttachmentsContext", () => {
  it("notes video metadata honestly", () => {
    const text = formatWorkspaceChatAttachmentsContext([
      {
        kind: "video",
        name: "pitch.mp4",
        mimeType: "video/mp4",
        byteLength: 5000
      }
    ]);
    expect(text).toContain("pitch.mp4");
    expect(text).toContain("not ingested as frames");
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

  it("returns toolTraces when the tool-loop provider runs", async () => {
    const recordedToolNames: string[] = [];
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeWorkspaceChatFactory(),
      workspaceChatCreateToolLoopProvider: () =>
        createFakeToolLoopProvider((input: ToolLoopCompletionInput) => {
          recordedToolNames.push(...input.tools.map((tool) => tool.name));
          return {
            text: "Used read tools to inspect the project.",
            toolTraces: [
              {
                toolName: "project_navigator_read",
                title: "Read manuscript hierarchy",
                input: {},
                output: {
                  title: BELLWETHER_FIXTURE_NAVIGATOR.title,
                  totals: BELLWETHER_FIXTURE_NAVIGATOR.totals
                },
                ok: true
              }
            ]
          };
        })
    });
    await configureOpenAi(app);
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "What scenes should I revise next?",
        projectId: PROJECT,
        mode: "agent",
        model: "gpt-4.1-mini",
        effort: "fast"
      })
    });
    expect(chat.status).toBe(200);
    const body = await chat.json();
    expect(body).toMatchObject({
      mode: "agent",
      model: "gpt-4.1-mini",
      effort: "fast",
      reply: "Used read tools to inspect the project.",
      toolTraces: [
        expect.objectContaining({
          toolName: "project_navigator_read",
          title: "Read manuscript hierarchy",
          ok: true,
          summary: expect.stringContaining("Hierarchy")
        })
      ]
    });
    expect(recordedToolNames).toEqual(
      expect.arrayContaining(["project_navigator_read"])
    );
  });
});

describe("POST /api/workspace/chat/stream", () => {
  it("returns event-stream with status and done for tool-loop turns", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig(),
      openAiCompletionProviderFactory: fakeWorkspaceChatFactory(),
      workspaceChatCreateToolLoopProvider: () =>
        createFakeToolLoopProvider({
          text: "Streaming tool-loop reply.",
          toolTraces: [
            {
              toolName: "project_navigator_read",
              title: "Read manuscript hierarchy",
              input: {},
              output: { title: BELLWETHER_FIXTURE_NAVIGATOR.title },
              ok: true
            }
          ]
        })
    });
    await configureOpenAi(app);
    const chat = await app.request("/api/workspace/chat/stream", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "What should I revise next?",
        projectId: PROJECT,
        mode: "agent",
        model: "gpt-4.1-mini",
        effort: "fast"
      })
    });
    expect(chat.status).toBe(200);
    expect(chat.headers.get("content-type")).toContain("text/event-stream");
    const body = await chat.text();
    expect(body).toContain("event: status");
    expect(body).toContain("event: done");
    expect(body).toContain("Streaming tool-loop reply.");
  });

  it("streams provider-soft done when no key is configured", async () => {
    const { app } = await openSeededApp({
      kekConfig: createTestProviderKekRuntimeConfig()
    });
    const chat = await app.request("/api/workspace/chat/stream", {
      method: "POST",
      headers: originHeaders(),
      body: JSON.stringify({
        message: "Hello agent",
        projectId: PROJECT
      })
    });
    expect(chat.status).toBe(200);
    const body = await chat.text();
    expect(body).toContain("event: status");
    expect(body).toContain("event: done");
    expect(body).toContain("PROVIDER_NOT_CONFIGURED");
  });
});
