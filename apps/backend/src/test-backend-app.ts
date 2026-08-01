import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  createBookReaderServices,
  createCanvasServices,
  createCaptureServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createMemoryCaptureObjectStorage,
  createProjectMembership,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryWriterProfileRepository,
  createSceneWritingServices,
  type CaptureObjectStoragePort
} from "@ghostwriter/core";
import {
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
  createPostgresCaptureAttachmentRepository,
  createPostgresCaptureDocumentRepository,
  createPostgresCaptureScenePromotionUnitOfWork,
  createPostgresProjectRepository,
  createPostgresSceneDocumentRepository,
  seedProject,
  toRepositoryDatabase
} from "@ghostwriter/storage";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "@ghostwriter/storage/pglite";
import { user } from "@ghostwriter/storage";
import { createApp } from "./app.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import {
  createTestAgentProviderRuntime,
  type OpenAiCompletionProviderFactory,
  type OpenAiValidationProviderFactory
} from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import type { ScenePartnerImageGenerator } from "./scene-partner-routes.js";

export const testBackendClosers: Array<() => Promise<void>> = [];
export const TEST_BACKEND_ORIGIN = "https://app.example.test";

export const TEST_BACKEND_SESSION: AuthenticatedSession = {
  account: {
    id: "account-test",
    name: "Test Writer",
    email: "writer@example.test",
    emailVerified: true
  },
  session: {
    id: "session-test",
    expiresAt: "2026-07-18T19:00:00.000Z"
  }
};

export function fakeBackendAuth(
  session: AuthenticatedSession | null = TEST_BACKEND_SESSION
): AuthGateway {
  return {
    handler: () => Response.json({ auth: "handled" }),
    getSession: async () => session,
    ensureDemoCredentialAccount: async () => {},
    signInDemo: async () =>
      Response.json(
        { ok: true },
        {
          headers: {
            "set-cookie":
              "ghostwriter.session_token=fake-demo; HttpOnly; SameSite=Lax; Path=/"
          }
        }
      )
  };
}

export async function createSeededBackendApp(
  auth: AuthGateway = fakeBackendAuth(),
  options?: Readonly<{
    objectStorage?: CaptureObjectStoragePort;
    now?: () => string;
    kekConfig?: ReturnType<typeof createTestProviderKekRuntimeConfig> | undefined;
    callsDisabled?: boolean;
    openAiValidationProviderFactory?: OpenAiValidationProviderFactory;
    openAiCompletionProviderFactory?: OpenAiCompletionProviderFactory;
    listModelsFactory?: import("./agent-provider-runtime.js").ModelListFactory;
    scenePartnerGenerateImage?: ScenePartnerImageGenerator;
    demoSeed?: Readonly<{ enabled: boolean }>;
  }>
) {
  const { db, close } = createPgliteDatabase();
  testBackendClosers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: TEST_BACKEND_SESSION.account.id,
    name: TEST_BACKEND_SESSION.account.name,
    email: TEST_BACKEND_SESSION.account.email,
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const repository = createPostgresProjectRepository(repositoryDatabase);
  const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
  const captureDocuments = createPostgresCaptureDocumentRepository(repositoryDatabase);
  const captureAttachmentsRepository =
    createPostgresCaptureAttachmentRepository(repositoryDatabase);
  const objectStorage = options?.objectStorage ?? createMemoryCaptureObjectStorage();
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  await seedProject(repository, BELLWETHER_FIXTURE);
  await repository.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: accountId(TEST_BACKEND_SESSION.account.id),
        role: "owner",
        createdAt: "2026-07-11T19:00:00.000Z"
      })
    );
  });
  let nextId = 0;
  const ids = {
    create: (kind: string) => {
      nextId += 1;
      return `${kind}-test-${nextId}`;
    }
  };
  const clock = { now: options?.now ?? (() => "2026-07-11T19:00:00.000Z") };
  const services = createGhostwriterServices({ projects: repository, ids, clock });
  const writing = createSceneWritingServices({
    projects: repository,
    sceneDocuments,
    ids,
    clock
  });
  const captures = createCaptureServices({
    projects: repository,
    captureDocuments,
    ids,
    clock
  });
  const captureAttachments = createCaptureAttachmentServices({
    projects: repository,
    captureDocuments,
    attachments: captureAttachmentsRepository,
    objectStorage,
    ids,
    clock
  });
  const capturePromotions = createCapturePromotionServices({
    projects: repository,
    captureDocuments,
    canvases,
    promotion: createPostgresCaptureScenePromotionUnitOfWork(repositoryDatabase),
    ids,
    clock
  });
  const canvas = createCanvasServices({
    projects: repository,
    canvases,
    sceneDocuments,
    sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
    ids,
    clock
  });
  const reader = createBookReaderServices({
    projects: repository,
    sceneDocuments,
    canvases
  });
  const identity = createIdentityServices({
    profiles: createMemoryWriterProfileRepository(),
    clock
  });
  const agentProvider = createTestAgentProviderRuntime({
    db: repositoryDatabase,
    projects: repository,
    captureDocuments,
    ids,
    clock,
    kekConfig: options?.kekConfig,
    callsDisabled: options?.callsDisabled,
    defaultValidationProviderFactory: options?.openAiValidationProviderFactory,
    defaultCompletionProviderFactory: options?.openAiCompletionProviderFactory,
    // Avoid real upstream /models probes in unit tests unless a factory is injected.
    listModelsFactory:
      options?.listModelsFactory ??
      (() => {
        throw Object.assign(new Error("model discovery stub"), { status: 503 });
      }),
    capturePromotions,
    sceneDocuments
  });

  return {
    app: createApp({
      services,
      writing,
      captures,
      captureAttachments,
      capturePromotions,
      canvas,
      reader,
      identity,
      agentProvider,
      auth,
      allowedOrigins: [TEST_BACKEND_ORIGIN],
      objectStorage,
      ...(options?.demoSeed === undefined ? {} : { demoSeed: options.demoSeed }),
      ...(options?.scenePartnerGenerateImage === undefined
        ? {}
        : { scenePartnerGenerateImage: options.scenePartnerGenerateImage })
    }),
    objectStorage: objectStorage as ReturnType<typeof createMemoryCaptureObjectStorage>
  };
}
