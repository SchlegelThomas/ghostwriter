import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CAPTURE_ATTACHMENT_MAX_PER_CAPTURE,
  CAPTURE_ATTACHMENT_PENDING_EXPIRY_MS,
  accountId,
  buildCaptureAttachmentObjectKey,
  captureId as toCaptureId,
  createBookReaderServices,
  createCanvasServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createCaptureServices,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryCaptureObjectStorage,
  createMemoryWriterProfileRepository,
  createProjectMembership,
  createSceneWritingServices,
  projectId as toProjectId
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
  toRepositoryDatabase,
  user
} from "@ghostwriter/storage";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "@ghostwriter/storage/pglite";
import { createApp } from "./app.js";
import { createTestAgentProviderRuntime } from "./agent-provider-runtime.js";
import { createUnavailableCaptureObjectStorage } from "./r2-capture-object-storage.js";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import type { CaptureObjectStoragePort } from "@ghostwriter/core";

const closers: Array<() => Promise<void>> = [];
const TEST_ORIGIN = "https://app.example.test";
const TEST_SESSION: AuthenticatedSession = {
  account: {
    id: "account-attachment-test",
    name: "Attachment Tester",
    email: "attachments@example.test",
    emailVerified: true
  },
  session: {
    id: "session-attachment-test",
    expiresAt: "2026-07-18T19:00:00.000Z"
  }
};

function fakeAuth(session: AuthenticatedSession | null = TEST_SESSION): AuthGateway {
  return {
    handler: () => Response.json({ auth: "handled" }),
    getSession: async () => session
  };
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function captureDocumentWith(text: string, blockId = "block-attachment-1") {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId },
          content: [{ type: "text", text }]
        }
      ]
    }
  };
}

function jsonHeaders(extra?: Record<string, string>) {
  return {
    "content-type": "application/json",
    origin: TEST_ORIGIN,
    ...extra
  };
}

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function attachmentApp(
  options?: Readonly<{
    objectStorage?: CaptureObjectStoragePort;
    now?: () => string;
    auth?: AuthGateway;
  }>
) {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: TEST_SESSION.account.id,
    name: TEST_SESSION.account.name,
    email: TEST_SESSION.account.email,
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const repository = createPostgresProjectRepository(repositoryDatabase);
  const sceneDocuments =
    createPostgresSceneDocumentRepository(repositoryDatabase);
  const captureDocuments =
    createPostgresCaptureDocumentRepository(repositoryDatabase);
  const captureAttachmentsRepository =
    createPostgresCaptureAttachmentRepository(repositoryDatabase);
  const objectStorage = options?.objectStorage ?? createMemoryCaptureObjectStorage();
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  await seedProject(repository, BELLWETHER_FIXTURE);
  await repository.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: accountId(TEST_SESSION.account.id),
        role: "owner",
        createdAt: "2026-07-11T19:00:00.000Z"
      })
    );
  });
  let nextId = 0;
  const ids = {
    create: (kind: string) => {
      nextId += 1;
      return `${kind}-attachment-${nextId}`;
    }
  };
  const clock = { now: options?.now ?? (() => "2026-07-24T12:00:00.000Z") };
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
    sceneCreation:
      createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
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
    kekConfig: undefined,
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
      auth: options?.auth ?? fakeAuth(),
      allowedOrigins: [TEST_ORIGIN],
      objectStorage
    }),
    objectStorage: objectStorage as ReturnType<typeof createMemoryCaptureObjectStorage>
  };
}

async function createCaptureThroughApi(app: Awaited<ReturnType<typeof attachmentApp>>["app"]) {
  const basePath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/captures`;
  const created = await app.request(basePath, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ sourceModality: "text" })
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  return body.head.captureId as string;
}

function attachmentsPath(captureIdValue: string) {
  return `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/captures/${captureIdValue}/attachments`;
}

describe("capture attachment routes", () => {
  it("requires auth and trusted origin on mutations", async () => {
    const { app } = await attachmentApp();
    const captureIdValue = await createCaptureThroughApi(app);
    const initPath = `${attachmentsPath(captureIdValue)}/init`;

    const { app: unauthApp } = await attachmentApp({ auth: fakeAuth(null) });
    const unauth = await unauthApp.request(initPath, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 4,
        clientSha256: "0".repeat(64)
      })
    });
    expect(unauth.status).toBe(401);

    const untrusted = await app.request(initPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 4,
        clientSha256: "0".repeat(64)
      })
    });
    expect(untrusted.status).toBe(403);
    await expect(untrusted.json()).resolves.toMatchObject({ code: "UNTRUSTED_ORIGIN" });
  });

  it("initializes without leaking storage metadata and finalizes ready uploads", async () => {
    const { app, objectStorage } = await attachmentApp();
    const captureIdValue = await createCaptureThroughApi(app);
    const text = "Hello attachment route.";
    const bytes = new TextEncoder().encode(text);
    const hash = await digestHex(bytes);

    const init = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: bytes.byteLength,
        clientSha256: hash
      })
    });
    expect(init.status).toBe(201);
    const initBody = await init.json();
    expect(initBody.attachment.state).toBe("pending");
    expect(initBody.upload.url).toContain("memory://put/");
    expect(initBody.uploadHeaders).toEqual({ "Content-Type": "text/plain" });
    expect(initBody.attachment).not.toHaveProperty("objectKey");
    expect(initBody.attachment).not.toHaveProperty("clientSha256");
    expect(JSON.stringify(initBody)).not.toMatch(/projects\/.+\/attachments\//);

    const attachmentIdValue = initBody.attachment.attachmentId as string;
    const objectKey = buildCaptureAttachmentObjectKey({
      projectId: toProjectId(BELLWETHER_FIXTURE_PROJECT_ID),
      captureId: toCaptureId(captureIdValue),
      attachmentId: initBody.attachment.attachmentId
    });
    objectStorage.putObjectForTest(objectKey, bytes);

    const finalized = await app.request(
      `${attachmentsPath(captureIdValue)}/${attachmentIdValue}/finalize`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({})
      }
    );
    expect(finalized.status).toBe(200);
    const finalizedBody = await finalized.json();
    expect(finalizedBody.attachment.state).toBe("ready");

    const listed = await app.request(attachmentsPath(captureIdValue));
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.attachments).toHaveLength(1);
    expect(listedBody.attachments[0].state).toBe("ready");

    const download = await app.request(
      `${attachmentsPath(captureIdValue)}/${attachmentIdValue}/download`
    );
    expect(download.status).toBe(200);
    const downloadBody = await download.json();
    expect(downloadBody.download.url).toContain("memory://get/");

    const deleted = await app.request(
      `${attachmentsPath(captureIdValue)}/${attachmentIdValue}`,
      { method: "DELETE", headers: { origin: TEST_ORIGIN } }
    );
    expect(deleted.status).toBe(200);
    const deletedBody = await deleted.json();
    expect(deletedBody.attachment.state).toBe("deleted");

    const deletedAgain = await app.request(
      `${attachmentsPath(captureIdValue)}/${attachmentIdValue}`,
      { method: "DELETE", headers: { origin: TEST_ORIGIN } }
    );
    expect(deletedAgain.status).toBe(200);
    await expect(deletedAgain.json()).resolves.toEqual(deletedBody);
  });

  it("refuses mismatched bytes with 200 refused summary", async () => {
    const { app, objectStorage } = await attachmentApp();
    const captureIdValue = await createCaptureThroughApi(app);
    const declared = new TextEncoder().encode("same-length-aaa");
    const actual = new TextEncoder().encode("same-length-bbb");
    const hash = await digestHex(declared);

    const init = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: declared.byteLength,
        clientSha256: hash
      })
    });
    const initBody = await init.json();
    const attachmentIdValue = initBody.attachment.attachmentId as string;
    const objectKey = buildCaptureAttachmentObjectKey({
      projectId: toProjectId(BELLWETHER_FIXTURE_PROJECT_ID),
      captureId: toCaptureId(captureIdValue),
      attachmentId: initBody.attachment.attachmentId
    });
    objectStorage.putObjectForTest(objectKey, actual);

    const finalized = await app.request(
      `${attachmentsPath(captureIdValue)}/${attachmentIdValue}/finalize`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({})
      }
    );
    expect(finalized.status).toBe(200);
    const finalizedBody = await finalized.json();
    expect(finalizedBody.attachment.state).toBe("refused");
    expect(finalizedBody.attachment.refusalCode).toBe("checksum-mismatch");
    expect(objectStorage.hasObject(objectKey)).toBe(false);
  });

  it("maps validation, quota, scope, and storage errors", async () => {
    const { app } = await attachmentApp({
      objectStorage: createUnavailableCaptureObjectStorage()
    });
    const captureIdValue = await createCaptureThroughApi(app);

    const invalidChecksum = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "not-a-hash"
      })
    });
    expect(invalidChecksum.status).toBe(400);
    await expect(invalidChecksum.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });

    const unsupported = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "evil.exe",
        declaredContentType: "application/x-msdownload",
        declaredByteSize: 1,
        clientSha256: "a".repeat(64)
      })
    });
    expect(unsupported.status).toBe(415);
    await expect(unsupported.json()).resolves.toMatchObject({
      code: "ATTACHMENT_TYPE_REFUSED"
    });

    const unavailable = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "note.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "b".repeat(64)
      })
    });
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "ATTACHMENT_STORAGE_UNAVAILABLE"
    });

    const { app: memoryApp } = await attachmentApp();
    const memoryCaptureId = await createCaptureThroughApi(memoryApp);
    for (let index = 0; index < CAPTURE_ATTACHMENT_MAX_PER_CAPTURE; index += 1) {
      const response = await memoryApp.request(`${attachmentsPath(memoryCaptureId)}/init`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          displayFilename: `file-${index}.txt`,
          declaredContentType: "text/plain",
          declaredByteSize: 1,
          clientSha256: `${index}`.padStart(64, "0")
        })
      });
      expect(response.status).toBe(201);
    }
    const quota = await memoryApp.request(`${attachmentsPath(memoryCaptureId)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "overflow.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "f".repeat(64)
      })
    });
    expect(quota.status).toBe(409);
    await expect(quota.json()).resolves.toMatchObject({ code: "ATTACHMENT_QUOTA_EXCEEDED" });

    const wrongScope = await memoryApp.request(
      `${attachmentsPath(memoryCaptureId)}/attachment-missing/finalize`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({})
      }
    );
    expect(wrongScope.status).toBe(404);
    await expect(wrongScope.json()).resolves.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("blocks init and finalize on archived or integrated captures but allows reads and delete", async () => {
    const { app, objectStorage } = await attachmentApp();
    const captureIdValue = await createCaptureThroughApi(app);
    const base = attachmentsPath(captureIdValue);

    const text = "Attachment on locked capture.";
    const bytes = new TextEncoder().encode(text);
    const hash = await digestHex(bytes);
    const init = await app.request(`${base}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "locked.txt",
        declaredContentType: "text/plain",
        declaredByteSize: bytes.byteLength,
        clientSha256: hash
      })
    });
    const initBody = await init.json();
    const attachmentIdValue = initBody.attachment.attachmentId as string;
    const objectKey = buildCaptureAttachmentObjectKey({
      projectId: toProjectId(BELLWETHER_FIXTURE_PROJECT_ID),
      captureId: toCaptureId(captureIdValue),
      attachmentId: initBody.attachment.attachmentId
    });
    objectStorage.putObjectForTest(objectKey, bytes);
    await app.request(`${base}/${attachmentIdValue}/finalize`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({})
    });

    await app.request(`${base.replace("/attachments", "")}/archive`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ archived: true })
    });

    const blockedInit = await app.request(`${base}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "blocked.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "c".repeat(64)
      })
    });
    expect(blockedInit.status).toBe(409);
    await expect(blockedInit.json()).resolves.toMatchObject({ code: "CAPTURE_NOT_EDITABLE" });

    const blockedFinalize = await app.request(`${base}/${attachmentIdValue}/finalize`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({})
    });
    expect(blockedFinalize.status).toBe(409);
    await expect(blockedFinalize.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_EDITABLE"
    });

    const listed = await app.request(base);
    expect(listed.status).toBe(200);
    const download = await app.request(`${base}/${attachmentIdValue}/download`);
    expect(download.status).toBe(200);
    const deleted = await app.request(`${base}/${attachmentIdValue}`, {
      method: "DELETE",
      headers: { origin: TEST_ORIGIN }
    });
    expect(deleted.status).toBe(200);
  });

  it("cleans up expired pending uploads during init", async () => {
    let nowMs = Date.parse("2026-07-24T12:00:00.000Z");
    const { app } = await attachmentApp({
      now: () => new Date(nowMs).toISOString()
    });
    const captureIdValue = await createCaptureThroughApi(app);
    const base = attachmentsPath(captureIdValue);

    const staleInit = await app.request(`${base}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "stale.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "d".repeat(64)
      })
    });
    expect(staleInit.status).toBe(201);
    const staleBody = await staleInit.json();
    expect(staleBody.attachment.state).toBe("pending");

    nowMs += CAPTURE_ATTACHMENT_PENDING_EXPIRY_MS + 60_000;

    const freshInit = await app.request(`${base}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "fresh.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "e".repeat(64)
      })
    });
    expect(freshInit.status).toBe(201);

    const listed = await app.request(base);
    const listedBody = await listed.json();
    const staleListed = listedBody.attachments.find(
      (attachment: { attachmentId: string }) =>
        attachment.attachmentId === staleBody.attachment.attachmentId
    );
    expect(staleListed?.state).toBe("deleted");
    expect(
      listedBody.attachments.some(
        (attachment: { state: string }) => attachment.state === "pending"
      )
    ).toBe(true);
  });

  it("rejects download when attachment is not ready", async () => {
    const { app } = await attachmentApp();
    const captureIdValue = await createCaptureThroughApi(app);
    const init = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "pending.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "1".repeat(64)
      })
    });
    const initBody = await init.json();
    const download = await app.request(
      `${attachmentsPath(captureIdValue)}/${initBody.attachment.attachmentId}/download`
    );
    expect(download.status).toBe(409);
    await expect(download.json()).resolves.toMatchObject({ code: "ATTACHMENT_NOT_READY" });
  });

  it("promoted captures refuse new uploads but retain list access", async () => {
    const { app } = await attachmentApp();
    const projectPath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}`;
    const captureIdValue = await createCaptureThroughApi(app);
    const saved = await app.request(`${projectPath}/captures/${captureIdValue}/body`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Promote me.", "block-promote-attachment")
      })
    });
    const savedBody = await saved.json();
    const signalBookId = BELLWETHER_FIXTURE.project.bookIds[0];
    const promoted = await app.request(`${projectPath}/captures/${captureIdValue}/promote`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        expectedCaptureWorkingVersion: savedBody.head.workingVersion,
        expectedCaptureContentHash: savedBody.head.contentHash,
        expectedProjectVersion: 1,
        title: "Promoted scene",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(promoted.status).toBe(201);

    const blocked = await app.request(`${attachmentsPath(captureIdValue)}/init`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        displayFilename: "blocked.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "2".repeat(64)
      })
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ code: "CAPTURE_NOT_EDITABLE" });

    const listed = await app.request(attachmentsPath(captureIdValue));
    expect(listed.status).toBe(200);
  });
});
