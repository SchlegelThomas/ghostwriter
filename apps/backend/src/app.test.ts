import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "@ghostwriter/core";
import type { AuthGateway, AuthenticatedSession } from "./auth.js";
import {
  createSeededBackendApp,
  fakeBackendAuth,
  testBackendClosers,
  TEST_BACKEND_ORIGIN,
  TEST_BACKEND_SESSION
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const TEST_SESSION = TEST_BACKEND_SESSION;

function captureDocumentWith(text: string, blockId = "block-capture-api-1") {
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
const SCENE_ID = "scene-arrival-at-bellwether";

function fakeAuth(session: AuthenticatedSession | null = TEST_SESSION): AuthGateway {
  return fakeBackendAuth(session);
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
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function seededApp(...args: Parameters<typeof createSeededBackendApp>) {
  return createSeededBackendApp(...args);
}

describe("backend app", () => {
  it("reports health", async () => {
    const { app } = await seededApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("mounts the authentication handler", async () => {
    const { app } = await seededApp();
    const response = await app.request("/api/auth/test");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ auth: "handled" });
  });

  it("rejects protected requests without a session", async () => {
    const { app } = await seededApp(fakeAuth(null));
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("idempotently bootstraps the signed-in writer profile", async () => {
    const { app } = await seededApp();
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
    const { app } = await seededApp();
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
    const { app } = await seededApp();
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

  it("runs an owner-scoped read capability and keeps optional Reader voice explicit", async () => {
    const { app } = await seededApp();
    const chat = await app.request("/api/workspace/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        message: "project.navigator.read",
        projectId: BELLWETHER_FIXTURE_PROJECT_ID
      })
    });

    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({
      reply: expect.stringContaining(BELLWETHER_FIXTURE_NAVIGATOR.title)
    });

    const voice = await app.request("/api/reader/speak", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ text: "The harbor answered.", voice: "noir" })
    });
    expect(voice.status).toBe(503);
    await expect(voice.json()).resolves.toMatchObject({
      code: "VOICE_UNAVAILABLE"
    });
  });

  it("executes typed commands and rejects stale writes", async () => {
    const { app } = await seededApp();
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
    const { app } = await seededApp();
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
    const { app } = await seededApp();
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
    const { app } = await seededApp();
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
    const { app } = await seededApp(auth.gateway);
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
    const { app } = await seededApp(auth.gateway);
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
    const { app } = await seededApp();
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

  it("creates, lists, saves, archives, and protects capture routes", async () => {
    const basePath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/captures`;
    const unauthenticated = await (
      await seededApp(fakeAuth(null))
    ).app.request(basePath, {
      method: "POST",
      headers: { origin: TEST_ORIGIN }
    });
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      code: "UNAUTHENTICATED"
    });

    const { app } = await seededApp();
    const untrusted = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(untrusted.status).toBe(403);
    await expect(untrusted.json()).resolves.toMatchObject({
      code: "UNTRUSTED_ORIGIN"
    });

    const created = await app.request(basePath, {
      method: "POST",
      headers: { origin: TEST_ORIGIN }
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.head).toMatchObject({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sourceModality: "text",
      workingVersion: 1,
      status: "draft"
    });
    const captureIdValue = createdBody.head.captureId as string;

    const emptyList = await app.request(basePath);
    expect(emptyList.status).toBe(200);
    await expect(emptyList.json()).resolves.toEqual({ captures: [] });

    const loaded = await app.request(`${basePath}/${captureIdValue}`);
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      head: { captureId: captureIdValue, workingVersion: 1 }
    });

    const document = captureDocumentWith("Capture prose for the inbox.");
    const saved = await app.request(`${basePath}/${captureIdValue}/body`, {
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

    const listed = await app.request(basePath);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.captures).toEqual([
      expect.objectContaining({
        captureId: captureIdValue,
        workingVersion: 2
      })
    ]);
    expect(listedBody.captures[0]).not.toHaveProperty("document");

    const stale = await app.request(`${basePath}/${captureIdValue}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Stale.", "block-stale")
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "CAPTURE_VERSION_CONFLICT"
    });

    const malformed = await app.request(`${basePath}/${captureIdValue}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 2,
        document: {
          schemaVersion: 1,
          document: { type: "doc", content: [] }
        }
      })
    });
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toEqual({
      error: "Invalid capture document.",
      code: "INVALID_CAPTURE_DOCUMENT"
    });

    const { app: otherApp } = await seededApp(
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
    const nonOwner = await otherApp.request(`${basePath}/${captureIdValue}`);
    expect(nonOwner.status).toBe(404);
    await expect(nonOwner.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_FOUND"
    });

    const wrongProject = await app.request(
      `/api/projects/project-not-here/captures/${captureIdValue}`
    );
    expect(wrongProject.status).toBe(404);
    await expect(wrongProject.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_FOUND"
    });

    const archived = await app.request(`${basePath}/${captureIdValue}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ archived: true })
    });
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({
      head: { status: "archived", archivedAt: expect.any(String) }
    });

    const hidden = await app.request(basePath);
    await expect(hidden.json()).resolves.toEqual({ captures: [] });
    const withArchived = await app.request(`${basePath}?includeArchived=true`);
    await expect(withArchived.json()).resolves.toEqual({
      captures: [
        expect.objectContaining({
          captureId: captureIdValue,
          status: "archived"
        })
      ]
    });

    const restored = await app.request(`${basePath}/${captureIdValue}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ archived: false })
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      head: { status: "draft" }
    });

    await app.request(`${basePath}/${captureIdValue}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({ archived: true })
    });
    const archivedSave = await app.request(`${basePath}/${captureIdValue}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 2,
        document: captureDocumentWith("Should not apply.", "block-archived")
      })
    });
    expect(archivedSave.status).toBe(409);
    await expect(archivedSave.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_EDITABLE"
    });

    const oversized = await app.request(`${basePath}/${captureIdValue}/body`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN
      },
      body: JSON.stringify({
        expectedWorkingVersion: 2,
        document: "x".repeat(2 * 1_024 * 1_024)
      })
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
  });

  it("promotes captures into scenes with guarded optimistic concurrency", async () => {
    const { app } = await seededApp();
    const projectPath = `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}`;
    const basePath = `${projectPath}/captures`;
    const signalBookId = BELLWETHER_FIXTURE.project.bookIds[0];
    const lowTideChapterId = "chapter-low-tide";

    const { app: unauthApp } = await seededApp(fakeAuth(null));
    const unauthenticated = await unauthApp.request(
      `${basePath}/capture-test/promote`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: JSON.stringify({})
      }
    );
    expect(unauthenticated.status).toBe(401);

    const untrusted = await app.request(`${basePath}/capture-test/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(untrusted.status).toBe(403);
    await expect(untrusted.json()).resolves.toMatchObject({
      code: "UNTRUSTED_ORIGIN"
    });

    const created = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const createdBody = await created.json();
    const captureIdValue = createdBody.head.captureId as string;
    const promotePath = `${basePath}/${captureIdValue}/promote`;

    const emptyPromote = await app.request(promotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: 1,
        expectedCaptureContentHash: createdBody.head.contentHash,
        expectedProjectVersion: 1,
        title: "Should not promote",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(emptyPromote.status).toBe(409);
    await expect(emptyPromote.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_PROMOTABLE"
    });

    const prose = "Exact capture prose for promotion.";
    const saved = await app.request(`${basePath}/${captureIdValue}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith(prose, "block-promote-exact")
      })
    });
    const savedBody = await saved.json();
    const captureHead = savedBody.head as {
      workingVersion: number;
      contentHash: string;
      document: unknown;
    };

    const navigatorBefore = await app.request(`${projectPath}/navigator`);
    const navigatorBeforeBody = await navigatorBefore.json();
    const sceneCountBefore = navigatorBeforeBody.totals.scenes as number;

    const unassignedPromote = await app.request(promotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: captureHead.workingVersion,
        expectedCaptureContentHash: captureHead.contentHash,
        expectedProjectVersion: 1,
        title: "From the inbox",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(unassignedPromote.status).toBe(201);
    const unassignedBody = await unassignedPromote.json();
    expect(unassignedBody).toMatchObject({
      captureHead: {
        status: "integrated",
        integratedSceneId: unassignedBody.scene.id,
        integrationRevisionId: expect.any(String),
        integratedAt: expect.any(String),
        integratedByAccountId: TEST_SESSION.account.id
      },
      scene: { title: "From the inbox", bookId: signalBookId },
      sceneDocumentHead: {
        workingVersion: 1,
        document: captureHead.document
      },
      navigator: { version: 2 }
    });
    expect(unassignedBody.sceneDocumentHead.document.document.content?.[0]).toMatchObject(
      { attrs: { id: "block-promote-exact" } }
    );
    expect(unassignedBody).not.toHaveProperty("canvas");

    const listedAfterPromote = await app.request(basePath);
    expect(listedAfterPromote.status).toBe(200);
    const listedAfterPromoteBody = await listedAfterPromote.json();
    expect(listedAfterPromoteBody.captures).toEqual([
      expect.objectContaining({
        captureId: captureIdValue,
        status: "integrated",
        integratedSceneId: unassignedBody.scene.id,
        integrationRevisionId: unassignedBody.captureHead.integrationRevisionId,
        integratedAt: unassignedBody.captureHead.integratedAt,
        integratedByAccountId: TEST_SESSION.account.id
      })
    ]);
    expect(listedAfterPromoteBody.captures[0]).not.toHaveProperty("document");

    const integratedAgain = await app.request(promotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: unassignedBody.captureHead.workingVersion,
        expectedCaptureContentHash: unassignedBody.captureHead.contentHash,
        expectedProjectVersion: 2,
        title: "Again",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(integratedAgain.status).toBe(409);
    await expect(integratedAgain.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_PROMOTABLE"
    });

    const captureMissingBoard = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureMissingBoardBody = await captureMissingBoard.json();
    const captureMissingBoardId = captureMissingBoardBody.head.captureId as string;
    await app.request(`${basePath}/${captureMissingBoardId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Missing board.", "block-missing-board")
      })
    });
    const loadedMissingBoard = await app.request(`${basePath}/${captureMissingBoardId}`);
    const loadedMissingBoardBody = await loadedMissingBoard.json();
    const missingBoard = await app.request(
      `${basePath}/${captureMissingBoardId}/promote`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: JSON.stringify({
          expectedCaptureWorkingVersion: loadedMissingBoardBody.head.workingVersion,
          expectedCaptureContentHash: loadedMissingBoardBody.head.contentHash,
          expectedProjectVersion: 2,
          title: "Missing board",
          manuscriptPlacement: { kind: "unassigned", bookId: signalBookId },
          canvas: {
            expectedCanvasVersion: 1,
            x: 0,
            y: 0,
            width: 200,
            height: 120,
            z: 1
          }
        })
      }
    );
    expect(missingBoard.status).toBe(404);
    await expect(missingBoard.json()).resolves.toMatchObject({
      code: "CANVAS_NOT_FOUND"
    });

    const captureTwo = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureTwoBody = await captureTwo.json();
    const captureTwoId = captureTwoBody.head.captureId as string;
    const savedTwo = await app.request(`${basePath}/${captureTwoId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Chapter promotion prose.", "block-chapter-promo")
      })
    });
    const savedTwoBody = await savedTwo.json();

    await app.request(`${projectPath}/canvas`);
    const chapterPromote = await app.request(`${basePath}/${captureTwoId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: savedTwoBody.head.workingVersion,
        expectedCaptureContentHash: savedTwoBody.head.contentHash,
        expectedProjectVersion: 2,
        title: "Chapter promotion",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: signalBookId,
          chapterId: lowTideChapterId
        },
        canvas: {
          expectedCanvasVersion: 1,
          x: 120,
          y: 80,
          width: 240,
          height: 160,
          z: 3,
          storyOrderHint: 5
        }
      })
    });
    expect(chapterPromote.status).toBe(201);
    const chapterBody = await chapterPromote.json();
    expect(chapterBody).toMatchObject({
      scene: { title: "Chapter promotion", bookId: signalBookId },
      canvas: {
        board: {
          version: 2,
          objects: [
            expect.objectContaining({
              kind: "scene-card",
              sceneId: chapterBody.scene.id,
              storyOrderHint: 5
            })
          ]
        },
        spine: expect.objectContaining({ canvasVersion: 2 })
      }
    });
    expect(chapterBody.scene.id).toBe(chapterBody.captureHead.integratedSceneId);

    const captureThree = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureThreeBody = await captureThree.json();
    const captureThreeId = captureThreeBody.head.captureId as string;
    await app.request(`${basePath}/${captureThreeId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Stale checks.", "block-stale-promo")
      })
    });
    const loadedThree = await app.request(`${basePath}/${captureThreeId}`);
    const loadedThreeBody = await loadedThree.json();
    const stalePromotePath = `${basePath}/${captureThreeId}/promote`;
    const staleVersion = await app.request(stalePromotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: 1,
        expectedCaptureContentHash: loadedThreeBody.head.contentHash,
        expectedProjectVersion: 3,
        title: "Stale version",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(staleVersion.status).toBe(409);
    await expect(staleVersion.json()).resolves.toMatchObject({
      code: "CAPTURE_VERSION_CONFLICT"
    });

    const staleHash = await app.request(stalePromotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedThreeBody.head.workingVersion,
        expectedCaptureContentHash: "0".repeat(64),
        expectedProjectVersion: 3,
        title: "Stale hash",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(staleHash.status).toBe(409);
    await expect(staleHash.json()).resolves.toMatchObject({
      code: "CAPTURE_CONTENT_CHANGED"
    });

    const staleProject = await app.request(stalePromotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedThreeBody.head.workingVersion,
        expectedCaptureContentHash: loadedThreeBody.head.contentHash,
        expectedProjectVersion: 1,
        title: "Stale project",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(staleProject.status).toBe(409);
    await expect(staleProject.json()).resolves.toMatchObject({
      code: "VERSION_CONFLICT"
    });

    const captureFour = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureFourBody = await captureFour.json();
    const captureFourId = captureFourBody.head.captureId as string;
    await app.request(`${basePath}/${captureFourId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Canvas stale.", "block-canvas-stale")
      })
    });
    const loadedFour = await app.request(`${basePath}/${captureFourId}`);
    const loadedFourBody = await loadedFour.json();
    await app.request(`${projectPath}/canvas`);
    const staleCanvas = await app.request(`${basePath}/${captureFourId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedFourBody.head.workingVersion,
        expectedCaptureContentHash: loadedFourBody.head.contentHash,
        expectedProjectVersion: 3,
        title: "Stale canvas",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId },
        canvas: {
          expectedCanvasVersion: 99,
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          z: 1
        }
      })
    });
    expect(staleCanvas.status).toBe(409);
    await expect(staleCanvas.json()).resolves.toMatchObject({
      code: "CANVAS_VERSION_CONFLICT"
    });

    const navigatorAfterStale = await app.request(`${projectPath}/navigator`);
    const navigatorAfterStaleBody = await navigatorAfterStale.json();
    expect(navigatorAfterStaleBody.totals.scenes).toBe(sceneCountBefore + 2);

    const captureSix = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureSixBody = await captureSix.json();
    const captureSixId = captureSixBody.head.captureId as string;
    await app.request(`${basePath}/${captureSixId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Archived promote.", "block-archived-promo")
      })
    });
    const loadedSix = await app.request(`${basePath}/${captureSixId}`);
    const loadedSixBody = await loadedSix.json();
    await app.request(`${basePath}/${captureSixId}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ archived: true })
    });
    const archivedPromote = await app.request(`${basePath}/${captureSixId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedSixBody.head.workingVersion,
        expectedCaptureContentHash: loadedSixBody.head.contentHash,
        expectedProjectVersion: 3,
        title: "Archived",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(archivedPromote.status).toBe(409);
    await expect(archivedPromote.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_PROMOTABLE"
    });

    const { app: otherApp } = await seededApp(
      fakeAuth({
        account: {
          id: "account-other-promote",
          name: "Other",
          email: "other-promote@example.test",
          emailVerified: true
        },
        session: {
          id: "session-other-promote",
          expiresAt: "2026-07-18T19:00:00.000Z"
        }
      })
    );
    const nonOwner = await otherApp.request(promotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: 2,
        expectedCaptureContentHash: captureHead.contentHash,
        expectedProjectVersion: 3,
        title: "Non-owner",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(nonOwner.status).toBe(404);
    await expect(nonOwner.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_FOUND"
    });

    const malformed = await app.request(stalePromotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedThreeBody.head.workingVersion,
        expectedCaptureContentHash: "not-a-hash",
        expectedProjectVersion: 3,
        title: "Bad hash",
        manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
      })
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST"
    });

    const invalidPlacement = await app.request(stalePromotePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedCaptureWorkingVersion: loadedThreeBody.head.workingVersion,
        expectedCaptureContentHash: loadedThreeBody.head.contentHash,
        expectedProjectVersion: 3,
        title: "Bad chapter",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: signalBookId,
          chapterId: "chapter-missing"
        }
      })
    });
    expect(invalidPlacement.status).toBe(404);
    await expect(invalidPlacement.json()).resolves.toMatchObject({
      code: "RECORD_NOT_FOUND"
    });

    const oversized = await app.request(stalePromotePath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        "content-length": String(70_000)
      },
      body: "x".repeat(70_000)
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });

    const captureSeven = await app.request(basePath, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ sourceModality: "text" })
    });
    const captureSevenBody = await captureSeven.json();
    const captureSevenId = captureSevenBody.head.captureId as string;
    await app.request(`${basePath}/${captureSevenId}/body`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: captureDocumentWith("Concurrent.", "block-concurrent-promo")
      })
    });
    const loadedSeven = await app.request(`${basePath}/${captureSevenId}`);
    const loadedSevenBody = await loadedSeven.json();
    const concurrentPath = `${basePath}/${captureSevenId}/promote`;
    const concurrentBody = JSON.stringify({
      expectedCaptureWorkingVersion: loadedSevenBody.head.workingVersion,
      expectedCaptureContentHash: loadedSevenBody.head.contentHash,
      expectedProjectVersion: 3,
      title: "Concurrent winner",
      manuscriptPlacement: { kind: "unassigned", bookId: signalBookId }
    });
    const [first, second] = await Promise.all([
      app.request(concurrentPath, {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: concurrentBody
      }),
      app.request(concurrentPath, {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: concurrentBody
      })
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    await expect(loser.json()).resolves.toMatchObject({
      code: "CAPTURE_NOT_PROMOTABLE"
    });
  });

  it("requires a trusted origin for canonical mutations", async () => {
    const { app } = await seededApp();
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
    const { app } = await seededApp(
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
    const { app } = await seededApp();
    const response = await app.request(
      `/api/projects/${BELLWETHER_FIXTURE_PROJECT_ID}/navigator`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(BELLWETHER_FIXTURE_NAVIGATOR);
  });

  it("returns 404 for an unknown project", async () => {
    const { app } = await seededApp();
    const response = await app.request("/api/projects/project-not-here/navigator");

    expect(response.status).toBe(404);
  });

  it("serves a bounded book reader projection without taking a scene lease", async () => {
    const { app } = await seededApp();
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
    const { app } = await seededApp(auth.gateway);
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
