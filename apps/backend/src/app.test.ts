import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  createBookReaderServices,
  createCanvasServices,
  createProjectMembership,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryWriterProfileRepository,
  createSceneWritingServices
} from "@ghostwriter/core";
import {
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
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

const closers: Array<() => Promise<void>> = [];
const TEST_ORIGIN = "https://app.example.test";
const SCENE_ID = "scene-arrival-at-bellwether";
const TEST_SESSION: AuthenticatedSession = {
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

function fakeAuth(session: AuthenticatedSession | null = TEST_SESSION): AuthGateway {
  return {
    handler: () => Response.json({ auth: "handled" }),
    getSession: async () => session
  };
}

function switchableAuth(initial: AuthenticatedSession) {
  let current = initial;
  return {
    gateway: {
      handler: () => Response.json({ auth: "handled" }),
      getSession: async () => current
    } satisfies AuthGateway,
    use(session: AuthenticatedSession) {
      current = session;
    }
  };
}

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function seededApp(auth: AuthGateway = fakeAuth()) {
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
      return `${kind}-test-${nextId}`;
    }
  };
  const services = createGhostwriterServices({
    projects: repository,
    ids,
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });
  const writing = createSceneWritingServices({
    projects: repository,
    sceneDocuments,
    ids,
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });
  const canvas = createCanvasServices({
    projects: repository,
    canvases,
    sceneDocuments,
    sceneCreation:
      createPostgresCanvasSceneCreationUnitOfWork(repositoryDatabase),
    ids,
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });
  const reader = createBookReaderServices({
    projects: repository,
    sceneDocuments,
    canvases
  });
  const identity = createIdentityServices({
    profiles: createMemoryWriterProfileRepository(),
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });

  return createApp({
    services,
    writing,
    canvas,
    reader,
    identity,
    auth,
    allowedOrigins: [TEST_ORIGIN]
  });
}

describe("backend app", () => {
  it("reports health", async () => {
    const app = await seededApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("mounts the authentication handler", async () => {
    const app = await seededApp();
    const response = await app.request("/api/auth/test");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ auth: "handled" });
  });

  it("rejects protected requests without a session", async () => {
    const app = await seededApp(fakeAuth(null));
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("idempotently bootstraps the signed-in writer profile", async () => {
    const app = await seededApp();
    const first = await app.request("/api/me");
    const second = await app.request("/api/me");

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      account: { id: "account-test", email: "writer@example.test" },
      profile: { accountId: "account-test", displayName: "Test Writer" }
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      profile: {
        createdAt: "2026-07-11T19:00:00.000Z",
        updatedAt: "2026-07-11T19:00:00.000Z"
      }
    });
  });

  it("updates the writer profile with origin and version checks", async () => {
    const app = await seededApp();
    const me = await (await app.request("/api/me")).json();
    const response = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        displayName: "Writer Choice",
        expectedVersion: me.profile.version
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { displayName: "Writer Choice", version: 2 }
    });
  });

  it("lists and creates writer-owned projects", async () => {
    const app = await seededApp();
    const before = await app.request("/api/projects");
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({
      projects: [{ id: BELLWETHER_FIXTURE_PROJECT_ID }]
    });

    const created = await app.request("/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        title: "A Map of Quiet Stars",
        firstBookTitle: "The Long Way Home"
      })
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      title: "A Map of Quiet Stars",
      version: 1,
      books: [{ title: "The Long Way Home" }]
    });
    const after = await app.request("/api/projects");
    await expect(after.json()).resolves.toMatchObject({
      projects: [
        { id: BELLWETHER_FIXTURE_PROJECT_ID },
        { title: "A Map of Quiet Stars" }
      ]
    });
  });

  it("executes typed commands and rejects stale writes", async () => {
    const app = await seededApp();
    const renamed = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: { type: "project.rename", title: "Renamed Bellwether" }
        })
      }
    );
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      title: "Renamed Bellwether",
      version: 2
    });

    const stale = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/commands`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN
        },
        body: JSON.stringify({
          expectedVersion: 1,
          command: { type: "project.rename", title: "Stale" }
        })
      }
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "VERSION_CONFLICT"
    });
  });

  it("serves guarded Canvas commands, history, preference, and undo", async () => {
    const app = await seededApp();
    const basePath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas`;
    const initial = await app.request(basePath);
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      board: { version: 1, objects: [], links: [] },
      spine: { projectVersion: 1, canvasVersion: 1 }
    });

    const created = await app.request(`${basePath}/commands`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.create",
          object: {
            kind: "note",
            x: 100,
            y: 200,
            width: 240,
            height: 140,
            z: 1,
            authority: "confirmed",
            label: "Backend note",
            note: { body: "Backend note" }
          }
        }
      })
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({
      board: {
        version: 2,
        objects: [expect.objectContaining({ kind: "note" })]
      }
    });
    const objectId = createdBody.board.objects[0].id as string;

    const stale = await app.request(`${basePath}/commands`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.move",
          objectId,
          x: 0,
          y: 0
        }
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "CANVAS_VERSION_CONFLICT"
    });

    const preference = await app.request(`${basePath}/preference`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        x: 400,
        y: -200,
        zoom: 1.75,
        selectedObjectId: objectId
      })
    });
    expect(preference.status).toBe(200);
    await expect(preference.json()).resolves.toMatchObject({
      preference: {
        x: 400,
        y: -200,
        zoom: 1.75,
        selectedObjectId: objectId
      }
    });
    const unchanged = await app.request(basePath);
    await expect(unchanged.json()).resolves.toMatchObject({
      board: { version: 2 }
    });

    const history = await app.request(`${basePath}/history`);
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      revisions: [
        { boardVersion: 2, reason: "command" },
        { boardVersion: 1, reason: "genesis" }
      ]
    });
    const undone = await app.request(`${basePath}/history/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedCanvasVersion: 2 })
    });
    expect(undone.status).toBe(201);
    await expect(undone.json()).resolves.toMatchObject({
      board: { version: 3, objects: [] }
    });
  });

  it("atomically creates a Draft scene from explicit Canvas placement", async () => {
    const app = await seededApp();
    const basePath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas`;
    await app.request(basePath);
    const created = await app.request(`${basePath}/scenes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedProjectVersion: 1,
        expectedCanvasVersion: 1,
        title: "Canvas handoff",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0],
          position: 1
        },
        canvas: {
          x: 640,
          y: 280,
          width: 260,
          height: 160,
          z: 3,
          storyOrderHint: 2
        }
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({
      scene: { title: "Canvas handoff" },
      sceneDocumentHead: { workingVersion: 1 },
      navigator: { version: 2 },
      canvas: {
        board: {
          version: 2,
          objects: [
            expect.objectContaining({
              kind: "scene-card",
              sceneId: createdBody.scene.id
            })
          ]
        }
      }
    });

    const stale = await app.request(`${basePath}/scenes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedProjectVersion: 1,
        expectedCanvasVersion: 2,
        title: "Must not exist",
        manuscriptPlacement: {
          kind: "unassigned",
          bookId: BELLWETHER_FIXTURE.project.bookIds[0]
        },
        canvas: { x: 0, y: 0, width: 200, height: 120, z: 1 }
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "VERSION_CONFLICT"
    });
    const navigator = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    await expect(navigator.json()).resolves.toMatchObject({
      version: 2,
      totals: { scenes: BELLWETHER_FIXTURE.scenes.length + 1 }
    });
    const canvas = await app.request(basePath);
    await expect(canvas.json()).resolves.toMatchObject({
      board: { version: 2, objects: [{ sceneId: createdBody.scene.id }] }
    });
  });

  it("rejects unbounded Canvas payloads and arbitrary image fetch metadata", async () => {
    const app = await seededApp();
    const path =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas/commands`;
    const arbitraryFetch = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.create",
          object: {
            kind: "image-reference",
            x: 0,
            y: 0,
            width: 200,
            height: 120,
            z: 1,
            authority: "confirmed",
            label: "Remote image",
            image: { url: "https://example.test/not-allowed.png" }
          }
        }
      })
    });
    expect(arbitraryFetch.status).toBe(400);
    await expect(arbitraryFetch.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST"
    });

    const oversized = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedCanvasVersion: 1,
        command: {
          type: "canvas.object.create",
          object: {
            kind: "note",
            x: 0,
            y: 0,
            width: 200,
            height: 120,
            z: 1,
            authority: "confirmed",
            label: "Oversized",
            note: { body: "x".repeat(70_000) }
          }
        }
      })
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
    const unchanged = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas`
    );
    await expect(unchanged.json()).resolves.toMatchObject({
      board: { version: 1, objects: [] }
    });
  });

  it("ensures, leases, saves, and reloads a scene document from Postgres", async () => {
    const auth = switchableAuth(TEST_SESSION);
    const app = await seededApp(auth.gateway);
    const basePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}`;
    const workspace = await app.request(`${basePath}/workspace`);
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      head: {
        sceneId: SCENE_ID,
        workingVersion: 1,
        document: { schemaVersion: 1 }
      },
      lease: null
    });

    const lease = await app.request(`${basePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_ORIGIN }
    });
    expect(lease.status).toBe(200);
    await expect(lease.json()).resolves.toMatchObject({
      lease: { heldByCurrentSession: true }
    });

    const document = {
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-backend-saved" },
            content: [{ type: "text", text: "Persisted scene prose." }]
          }
        ]
      }
    };
    const saved = await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedWorkingVersion: 1, document })
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      head: { workingVersion: 2, document }
    });

    const stale = await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedWorkingVersion: 1, document })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "REVISION_CONFLICT"
    });

    auth.use({
      ...TEST_SESSION,
      session: { ...TEST_SESSION.session, id: "session-other-tab" }
    });
    const wrongSession = await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedWorkingVersion: 2, document })
    });
    expect(wrongSession.status).toBe(409);
    await expect(wrongSession.json()).resolves.toMatchObject({
      code: "LEASE_CONFLICT"
    });

    auth.use(TEST_SESSION);
    const reloaded = await app.request(`${basePath}/workspace`);
    expect(reloaded.status).toBe(200);
    await expect(reloaded.json()).resolves.toMatchObject({
      head: { workingVersion: 2, document },
      lease: { heldByCurrentSession: true }
    });

    const released = await app.request(`${basePath}/lease`, {
      method: "DELETE",
      headers: { origin: TEST_ORIGIN }
    });
    expect(released.status).toBe(204);
  });

  it("checkpoints, names, compares, lists, and restores immutable scene history", async () => {
    const auth = switchableAuth(TEST_SESSION);
    const app = await seededApp(auth.gateway);
    const basePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}`;
    const workspace = await (
      await app.request(`${basePath}/workspace`)
    ).json();
    const genesisRevisionId = workspace.head.checkpointRevisionId as string;
    await app.request(`${basePath}/lease`, {
      method: "POST",
      headers: { origin: TEST_ORIGIN }
    });

    const firstDocument = {
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-history" },
            content: [{ type: "text", text: "The first ending." }]
          }
        ]
      }
    };
    const secondDocument = {
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "block-history" },
            content: [{ type: "text", text: "The second ending." }]
          }
        ]
      }
    };
    await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: firstDocument
      })
    });

    const checkpoint = await app.request(`${basePath}/checkpoints`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedWorkingVersion: 2 })
    });
    expect(checkpoint.status).toBe(201);
    const checkpointBody = await checkpoint.json();
    expect(checkpointBody).toMatchObject({
      created: true,
      head: { workingVersion: 3 },
      revision: {
        parentRevisionId: genesisRevisionId,
        actorAccountId: TEST_SESSION.account.id,
        reason: "checkpoint"
      }
    });
    expect(checkpointBody.head).not.toHaveProperty("document");
    expect(checkpointBody.revision).not.toHaveProperty("document");

    const duplicateCheckpoint = await app.request(
      `${basePath}/checkpoints`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN
        },
        body: JSON.stringify({ expectedWorkingVersion: 3 })
      }
    );
    expect(duplicateCheckpoint.status).toBe(200);
    await expect(duplicateCheckpoint.json()).resolves.toMatchObject({
      created: false,
      head: { workingVersion: 3 },
      revision: { id: checkpointBody.revision.id }
    });

    await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 3,
        document: secondDocument
      })
    });
    const variant = await app.request(`${basePath}/variants`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 4,
        name: "  Alternate ending  "
      })
    });
    expect(variant.status).toBe(201);
    const variantBody = await variant.json();
    expect(variantBody).toMatchObject({
      checkpointCreated: true,
      head: { workingVersion: 5 },
      variant: {
        name: "Alternate ending",
        revisionId: variantBody.revision.id
      }
    });

    const history = await app.request(`${basePath}/history`);
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.revisions).toHaveLength(3);
    expect(historyBody.variants).toHaveLength(1);
    expect(historyBody.revisions[0]).not.toHaveProperty("document");
    expect(JSON.stringify(historyBody)).not.toContain("The first ending.");
    expect(JSON.stringify(historyBody)).not.toContain("The second ending.");

    const compared = await app.request(`${basePath}/compare`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        beforeRevisionId: checkpointBody.revision.id,
        afterRevisionId: variantBody.revision.id
      })
    });
    expect(compared.status).toBe(200);
    await expect(compared.json()).resolves.toMatchObject({
      comparison: {
        equal: false,
        blocks: [
          {
            blockId: "block-history",
            changes: ["changed"],
            before: { content: [{ text: "The first ending." }] },
            after: { content: [{ text: "The second ending." }] }
          }
        ]
      }
    });

    const restored = await app.request(`${basePath}/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 5,
        revisionId: checkpointBody.revision.id
      })
    });
    expect(restored.status).toBe(201);
    const restoredBody = await restored.json();
    expect(restoredBody).toMatchObject({
      head: {
        workingVersion: 6,
        document: firstDocument,
        checkpointRevisionId: restoredBody.revision.id
      },
      revision: {
        parentRevisionId: variantBody.revision.id,
        contentHash: checkpointBody.revision.contentHash,
        actorAccountId: TEST_SESSION.account.id,
        reason: "restore"
      }
    });
    expect(restoredBody.revision.id).not.toBe(checkpointBody.revision.id);

    const staleRestore = await app.request(`${basePath}/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 5,
        revisionId: checkpointBody.revision.id
      })
    });
    expect(staleRestore.status).toBe(409);
    await expect(staleRestore.json()).resolves.toMatchObject({
      code: "REVISION_CONFLICT"
    });

    const duplicateVariant = await app.request(`${basePath}/variants`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 6,
        name: "Alternate ending"
      })
    });
    expect(duplicateVariant.status).toBe(409);
    await expect(duplicateVariant.json()).resolves.toMatchObject({
      code: "VARIANT_NAME_CONFLICT"
    });

    const missingRevision = await app.request(`${basePath}/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 6,
        revisionId: "revision-not-here"
      })
    });
    expect(missingRevision.status).toBe(404);
    await expect(missingRevision.json()).resolves.toMatchObject({
      code: "REVISION_NOT_FOUND"
    });

    auth.use({
      ...TEST_SESSION,
      session: { ...TEST_SESSION.session, id: "session-other-tab" }
    });
    const wrongSession = await app.request(`${basePath}/checkpoints`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ expectedWorkingVersion: 6 })
    });
    expect(wrongSession.status).toBe(409);
    await expect(wrongSession.json()).resolves.toMatchObject({
      code: "LEASE_CONFLICT"
    });
    const unchangedHistory = await app.request(`${basePath}/history`);
    await expect(unchangedHistory.json()).resolves.toMatchObject({
      revisions: expect.arrayContaining([
        expect.objectContaining({ id: restoredBody.revision.id })
      ]),
      variants: [expect.objectContaining({ id: variantBody.variant.id })]
    });
  });

  it("rejects malformed and oversized scene documents without echoing prose", async () => {
    const app = await seededApp();
    const basePath =
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}`;
    const malformed = await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: {
          schemaVersion: 1,
          document: { type: "doc", content: [] }
        }
      })
    });
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toEqual({
      error: "Invalid scene document.",
      code: "INVALID_SCENE_DOCUMENT"
    });

    const oversized = await app.request(`${basePath}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: "x".repeat(2 * 1_024 * 1_024)
      })
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
  });

  it("requires a trusted origin for canonical mutations", async () => {
    const app = await seededApp();
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "No", firstBookTitle: "No" })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNTRUSTED_ORIGIN"
    });
  });

  it("does not disclose another account's project", async () => {
    const app = await seededApp(
      fakeAuth({
        account: {
          id: "account-other",
          name: "Other Writer",
          email: "other@example.test",
          emailVerified: true
        },
        session: {
          id: "session-other",
          expiresAt: "2026-07-18T19:00:00.000Z"
        }
      })
    );
    const list = await app.request("/api/projects");
    const project = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );
    const scene = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}/workspace`
    );
    const sceneHistory = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}/history`
    );
    const checkpoint = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}/checkpoints`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN
        },
        body: JSON.stringify({ expectedWorkingVersion: 1 })
      }
    );
    const canvas = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas`
    );
    const canvasCommand = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/canvas/commands`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN
        },
        body: JSON.stringify({
          expectedCanvasVersion: 1,
          command: {
            type: "canvas.object.create",
            object: {
              kind: "note",
              x: 0,
              y: 0,
              width: 200,
              height: 120,
              z: 1,
              authority: "confirmed",
              label: "Must not persist"
            }
          }
        })
      }
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ projects: [] });
    expect(project.status).toBe(404);
    await expect(project.json()).resolves.toEqual({ error: "Project not found." });
    expect(scene.status).toBe(404);
    await expect(scene.json()).resolves.toEqual({
      error: "Scene not found.",
      code: "SCENE_NOT_FOUND"
    });
    expect(sceneHistory.status).toBe(404);
    await expect(sceneHistory.json()).resolves.toMatchObject({
      code: "SCENE_NOT_FOUND"
    });
    expect(checkpoint.status).toBe(404);
    await expect(checkpoint.json()).resolves.toMatchObject({
      code: "SCENE_NOT_FOUND"
    });
    expect(canvas.status).toBe(404);
    await expect(canvas.json()).resolves.toMatchObject({
      code: "CANVAS_NOT_FOUND"
    });
    expect(canvasCommand.status).toBe(404);
    await expect(canvasCommand.json()).resolves.toMatchObject({
      code: "CANVAS_NOT_FOUND"
    });
  });

  it("serves the project navigator from Postgres", async () => {
    const app = await seededApp();
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(BELLWETHER_FIXTURE_NAVIGATOR);
  });

  it("returns 404 for an unknown project", async () => {
    const app = await seededApp();
    const response = await app.request("/api/projects/project-not-here/navigator");

    expect(response.status).toBe(404);
  });

  it("serves a bounded book reader projection without taking a scene lease", async () => {
    const app = await seededApp();
    const bookId = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!.id;
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/books/${bookId}/reader?pinSceneId=${SCENE_ID}`
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      bookId,
      bookTitle: "The Signal at Bellwether",
      pinSceneId: SCENE_ID,
      totals: { scenes: 4 }
    });
    expect(body.scenes.map((scene: { title: string }) => scene.title)).toEqual([
      "Arrival at Bellwether",
      "The dead frequency",
      "The call that hasn't happened",
      "The false rescue"
    ]);

    const lease = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/scenes/${SCENE_ID}/lease`,
      {
        method: "POST",
        headers: { origin: TEST_ORIGIN }
      }
    );
    expect(lease.status).toBe(200);
  });

  it("does not disclose unknown books to non-owners", async () => {
    const auth = switchableAuth(TEST_SESSION);
    const app = await seededApp(auth.gateway);
    const bookId = BELLWETHER_FIXTURE_NAVIGATOR.books[0]!.id;
    auth.use({
      ...TEST_SESSION,
      account: {
        ...TEST_SESSION.account,
        id: "account-stranger"
      }
    });
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/books/${bookId}/reader`
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROJECT_NOT_FOUND"
    });
  });
});
