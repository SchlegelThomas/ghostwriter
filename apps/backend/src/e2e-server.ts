import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  accountId,
  createBookReaderServices,
  createCanvasServices,
  createCaptureServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryCaptureObjectStorage,
  createSceneWritingServices,
  type DomainIdKind
} from "@ghostwriter/core";
import {
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
  createPostgresCaptureAttachmentRepository,
  createPostgresCaptureDocumentRepository,
  createPostgresCaptureScenePromotionUnitOfWork,
  createPostgresProjectRepository,
  createPostgresSceneDocumentRepository,
  createPostgresWriterProfileRepository,
  toRepositoryDatabase,
  user
} from "@ghostwriter/storage";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "@ghostwriter/storage/pglite";
import {
  createFakeStructuredCompletionProvider,
  createOpenAiProvider
} from "@ghostwriter/ai";
import { createApp } from "./app.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import { createTestAgentProviderRuntime } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";
import { seedHermeticHarryPotter } from "./hermetic-seed.js";

if (process.env.GHOSTWRITER_E2E !== "1") {
  throw new Error("The hermetic E2E server requires GHOSTWRITER_E2E=1.");
}

const liveOpenAi = process.env.GHOSTWRITER_E2E_LIVE_OPENAI === "1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const appOrigin = process.env.E2E_APP_ORIGIN ?? "http://127.0.0.1:4173";
const account = {
  id: "account-e2e-writer",
  name: "E2E Writer",
  email: "writer@example.test",
  emailVerified: true
} as const;
const session: AuthenticatedSession = {
  account,
  session: {
    id: "session-e2e-writer",
    expiresAt: "2099-07-18T19:00:00.000Z"
  }
};
const cookieName = "ghostwriter-e2e";

function e2eAuthGateway(): AuthGateway {
  return {
    async handler(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sign-in/social") && request.method === "POST") {
        const body = (await request.json()) as { callbackURL?: unknown };
        if (
          typeof body.callbackURL !== "string" ||
          new URL(body.callbackURL).origin !== appOrigin
        ) {
          return Response.json(
            { error: "Invalid E2E callback.", code: "INVALID_CALLBACK" },
            { status: 400 }
          );
        }
        return Response.json(
          { url: body.callbackURL, redirect: true },
          {
            headers: {
              "set-cookie": `${cookieName}=authenticated; HttpOnly; SameSite=Lax; Path=/`
            }
          }
        );
      }
      if (url.pathname.endsWith("/sign-out") && request.method === "POST") {
        return Response.json(
          { success: true },
          {
            headers: {
              "set-cookie": `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
            }
          }
        );
      }
      return Response.json({ error: "Unknown E2E auth route." }, { status: 404 });
    },
    async getSession(headers) {
      return headers.get("cookie")?.includes(`${cookieName}=authenticated`)
        ? session
        : null;
    },
    async ensureDemoCredentialAccount() {
      // Hermetic E2E keeps the fake Google path; demo sign-in only sets the e2e cookie.
    },
    async signInDemo() {
      return Response.json(
        { ok: true },
        {
          headers: {
            "set-cookie": `${cookieName}=authenticated; HttpOnly; SameSite=Lax; Path=/`
          }
        }
      );
    }
  };
}

const { db, close } = createPgliteDatabase();
await migratePgliteRepositoryDatabase(db);
await db.insert(user).values(account);
const repositoryDatabase = toRepositoryDatabase(db);
const projects = createPostgresProjectRepository(repositoryDatabase);
const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
const captureDocuments =
  createPostgresCaptureDocumentRepository(repositoryDatabase);
const canvases = createPostgresCanvasRepository(repositoryDatabase);
const profiles = createPostgresWriterProfileRepository(repositoryDatabase);
const clock = { now: () => new Date().toISOString() };
const ids = { create: (kind: DomainIdKind) => `${kind}_${randomUUID()}` };
const services = createGhostwriterServices({
  projects,
  ids,
  clock
});
const writing = createSceneWritingServices({
  projects,
  sceneDocuments,
  ids,
  clock
});
const captures = createCaptureServices({
  projects,
  captureDocuments,
  ids,
  clock
});
const objectStorage = createMemoryCaptureObjectStorage();
await seedHermeticHarryPotter({
  projects,
  sceneDocuments,
  captureDocuments,
  accountId: accountId(account.id),
  ids,
  clock,
  objectStorage
});
console.log(
  "Hermetic seed: Harry Potter series + character portraits ready for E2E writer."
);
const captureAttachments = createCaptureAttachmentServices({
  projects,
  captureDocuments,
  attachments: createPostgresCaptureAttachmentRepository(repositoryDatabase),
  objectStorage,
  ids,
  clock
});
const capturePromotions = createCapturePromotionServices({
  projects,
  captureDocuments,
  canvases,
  promotion: createPostgresCaptureScenePromotionUnitOfWork(repositoryDatabase),
  ids,
  clock
});
const canvas = createCanvasServices({
  projects,
  canvases,
  sceneDocuments,
  sceneCreation:
    createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
  ids,
  clock
});
const reader = createBookReaderServices({
  projects,
  sceneDocuments,
  canvases
});
const identity = createIdentityServices({ profiles, clock });

/** Hermetic BYOK + structured completions for local founder / Playwright validation. */
const hermeticFakeProvider = createFakeStructuredCompletionProvider((input) => {
  const schemaName = input.outputSchema.name;
  if (
    schemaName === "workspace-chat-turn-v1" ||
    schemaName === "workspace_chat_turn_v1"
  ) {
    const projectLine =
      input.inputText
        .split("\n")
        .find((line) => line.startsWith("Project:"))
        ?.replace(/^Project:\s*/, "")
        .trim() ?? "this project";
    return {
      output: {
        reply: `Here is a propose-only note about ${projectLine}. I used the open manuscript context and will not claim canon was written.`
      }
    };
  }
  if (schemaName === "scene_partner_turn_v1" || schemaName === "scene-partner-turn-v1") {
    return {
      output: {
        schemaId: "scene-partner-turn-v1",
        thinkingSteps: ["Reading idea", "Scanning scenes", "Drafting response"],
        assistantMessage:
          "I scanned the manuscript and this idea feels ready to become a new scene.",
        phase: "new-scene",
        matchedSceneId: null,
        proseDraft: "Soft light holds for a breath; the moment waits for the next line.",
        actions: ["apply-new-scene", "propose-image"],
        imagePrompt: "Quiet literary study of the capture idea"
      }
    };
  }
  if (schemaName === "sketch-fields-v1") {
    return {
      output: {
        schemaId: "sketch-fields-v1",
        purpose: "Force a present-tense choice.",
        conflict: "The log and the forecast disagree.",
        turn: "Someone cannot leave without answering."
      }
    };
  }
  if (schemaName === "character-sheet-v1") {
    return {
      output: {
        schemaId: "character-sheet-v1",
        storyKnowledgeId: "story_knowledge_e2e_character",
        desire: "Reach the harbor before the tide turns.",
        pressure: "A name spoken too soon.",
        voiceNotes: "Short sentences; salt in the vowels."
      }
    };
  }
  if (schemaName === "backdrop-fields-v1") {
    return {
      output: {
        schemaId: "backdrop-fields-v1",
        caption: "Fog presses the glass above the pier.",
        sensoryNotesFallback: "Wet rope, diesel, gulls."
      }
    };
  }
  return {
    output: {
      schemaId: "capture-reflection-v1",
      summary: "A harbor signal looking for its scene.",
      questions: ["Where does this land in the opening?"],
      possibleStoryJobs: [
        {
          label: "Cold open",
          rationale: "Establishes weather before the first arrival."
        }
      ]
    }
  };
});

/** 1×1 PNG — valid for Scene Partner preview and cover apply decode. */
const HERMETIC_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const hermeticFakeImage: ScenePartnerImageGenerator = async () => {
  return {
    ok: true,
    b64Json: HERMETIC_PNG_B64,
    dataUri: `data:image/png;base64,${HERMETIC_PNG_B64}`
  };
};

const liveOpenAiFactory = (apiKey: string) => createOpenAiProvider({ apiKey });
const hermeticProviderFactory = () => hermeticFakeProvider;
const providerFactory = liveOpenAi ? liveOpenAiFactory : hermeticProviderFactory;

const agentProvider = createTestAgentProviderRuntime({
  db: repositoryDatabase,
  projects,
  captureDocuments,
  ids,
  clock,
  kekConfig: createTestProviderKekRuntimeConfig(),
  defaultValidationProviderFactory: providerFactory,
  defaultCompletionProviderFactory: providerFactory,
  capturePromotions,
  sceneDocuments
});

/** Optional local-only seed of BYOK key for the hermetic writer. Never log the value. */
const seededOpenAiKey = process.env.GHOSTWRITER_E2E_SEED_OPENAI_KEY?.trim();
if (seededOpenAiKey !== undefined && seededOpenAiKey.length > 0) {
  await agentProvider.providerCredentials.setOpenAiCredential({
    accountId: accountId(account.id),
    plaintext: seededOpenAiKey
  });
  console.log("Hermetic seed: OpenAI key loaded for E2E writer (from env).");
}

const app = createApp({
  services,
  writing,
  captures,
  captureAttachments,
  capturePromotions,
  canvas,
  reader,
  identity,
  agentProvider,
  auth: e2eAuthGateway(),
  allowedOrigins: [appOrigin],
  objectStorage,
  demoSeed: { enabled: process.env.GHOSTWRITER_DEMO_SEED !== "0" },
  ...(liveOpenAi ? {} : { scenePartnerGenerateImage: hermeticFakeImage })
});
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ghostwriter hermetic backend listening on port ${info.port}`);
  console.log(`Trusted app origin: ${appOrigin}`);
  console.log(
    liveOpenAi
      ? "OpenAI: LIVE (GHOSTWRITER_E2E_LIVE_OPENAI=1)"
      : "OpenAI: hermetic fake provider"
  );
  if (seededOpenAiKey !== undefined && seededOpenAiKey.length > 0) {
    console.log("OpenAI: BYOK key seeded for E2E writer");
  }
});

async function shutdown(): Promise<void> {
  server.close();
  await close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
