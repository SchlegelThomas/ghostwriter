import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  accountId,
  createBookReaderServices,
  createCanvasServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createCaptureServices,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryCaptureObjectStorage,
  createSceneWritingServices,
  HARRY_POTTER_FIXTURE_PROJECT_ID,
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
import { createApp } from "./app.js";
import { createBetterAuthGateway } from "./auth.js";
import { createTestAgentProviderRuntime } from "./agent-provider-runtime.js";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import { DEMO_SEED_ACCOUNT } from "./demo-identity.js";
import {
  ensureDemoHarryPotterSeed,
  seedHermeticHarryPotter
} from "./hermetic-seed.js";
import {
  createSeededBackendApp,
  fakeBackendAuth,
  testBackendClosers,
  TEST_BACKEND_ORIGIN
} from "./test-backend-app.js";

afterEach(async () => {
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function createRealAuthDemoApp(demoSeedEnabled: boolean) {
  const { db, close } = createPgliteDatabase();
  testBackendClosers.push(close);
  await migratePgliteRepositoryDatabase(db);
  const repositoryDatabase = toRepositoryDatabase(db);
  const auth = createBetterAuthGateway(repositoryDatabase, {
    baseUrl: "http://localhost:8787",
    secret: "test-secret-that-is-at-least-thirty-two-characters",
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    trustedOrigins: [TEST_BACKEND_ORIGIN, "http://localhost:8787"],
    secureCookies: false
  });
  const projects = createPostgresProjectRepository(repositoryDatabase);
  const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
  const captureDocuments =
    createPostgresCaptureDocumentRepository(repositoryDatabase);
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  const objectStorage = createMemoryCaptureObjectStorage();
  const clock = { now: () => "2026-07-25T12:00:00.000Z" };
  const ids = { create: (kind: DomainIdKind) => `${kind}_${randomUUID()}` };
  const services = createGhostwriterServices({ projects, ids, clock });
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
    sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
    ids,
    clock
  });
  const reader = createBookReaderServices({
    projects,
    sceneDocuments,
    canvases
  });
  const identity = createIdentityServices({
    profiles: createPostgresWriterProfileRepository(repositoryDatabase),
    clock
  });
  const agentProvider = createTestAgentProviderRuntime({
    db: repositoryDatabase,
    projects,
    captureDocuments,
    ids,
    clock,
    kekConfig: createTestProviderKekRuntimeConfig(),
    capturePromotions,
    sceneDocuments
  });

  return createApp({
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
    demoSeed: { enabled: demoSeedEnabled }
  });
}

describe("demo seed sign-in", () => {
  it("sets a session cookie and serves /api/me when enabled", async () => {
    const app = await createRealAuthDemoApp(true);

    const signIn = await app.request("/api/demo/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_BACKEND_ORIGIN
      },
      body: "{}"
    });
    expect(signIn.status).toBe(200);
    await expect(signIn.json()).resolves.toEqual({ ok: true });
    const setCookie = signIn.headers.get("set-cookie");
    expect(setCookie).toContain("ghostwriter");

    const me = await app.request("/api/me", {
      headers: {
        cookie: setCookie ?? ""
      }
    });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      account: {
        id: DEMO_SEED_ACCOUNT.id,
        email: DEMO_SEED_ACCOUNT.email,
        name: DEMO_SEED_ACCOUNT.name
      }
    });
  });

  it("returns 404 when demo seed is disabled", async () => {
    const { app } = await createSeededBackendApp(fakeBackendAuth(null), {
      demoSeed: { enabled: false }
    });
    const response = await app.request("/api/demo/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_BACKEND_ORIGIN
      },
      body: "{}"
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_SEED_DISABLED"
    });
  });

  it("returns 404 when demo seed is omitted", async () => {
    const { app } = await createSeededBackendApp(fakeBackendAuth(null));
    const response = await app.request("/api/demo/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_BACKEND_ORIGIN
      },
      body: "{}"
    });
    expect(response.status).toBe(404);
  });
});

describe("ensureDemoHarryPotterSeed", () => {
  it("is idempotent and ensures demo membership when the project already exists", async () => {
    const { db, close } = createPgliteDatabase();
    testBackendClosers.push(close);
    await migratePgliteRepositoryDatabase(db);
    await db.insert(user).values({
      id: DEMO_SEED_ACCOUNT.id,
      name: DEMO_SEED_ACCOUNT.name,
      email: DEMO_SEED_ACCOUNT.email,
      emailVerified: true
    });
    const repositoryDatabase = toRepositoryDatabase(db);
    const projects = createPostgresProjectRepository(repositoryDatabase);
    const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
    const captureDocuments =
      createPostgresCaptureDocumentRepository(repositoryDatabase);
    const objectStorage = createMemoryCaptureObjectStorage();
    let nextId = 0;
    const ids = {
      create: (kind: DomainIdKind) => {
        nextId += 1;
        return `${kind}-demo-${nextId}`;
      }
    };
    const clock = { now: () => "2026-07-25T12:00:00.000Z" };
    const deps = {
      projects,
      sceneDocuments,
      captureDocuments,
      accountId: accountId(DEMO_SEED_ACCOUNT.id),
      ids,
      clock,
      objectStorage
    };

    await seedHermeticHarryPotter(deps);
    await expect(ensureDemoHarryPotterSeed(deps)).resolves.toBeUndefined();
    await expect(ensureDemoHarryPotterSeed(deps)).resolves.toBeUndefined();

    const project = await projects.getProject(HARRY_POTTER_FIXTURE_PROJECT_ID);
    expect(project).toBeDefined();
    const membership = await projects.getProjectMembership(
      HARRY_POTTER_FIXTURE_PROJECT_ID,
      accountId(DEMO_SEED_ACCOUNT.id)
    );
    expect(membership?.role).toBe("owner");
  });
});
