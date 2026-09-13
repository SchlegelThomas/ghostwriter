import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE_PROJECT_ID,
  MCP_GRANT_CAPTURE_TOOL_NAMES,
  MCP_GRANT_TOOL_NAMES,
  McpGrantNotFoundError
} from "@ghostwriter/core";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;
const BELLWETHER_SCENE_ID = "scene-arrival-at-bellwether";
const BELLWETHER_BOOK_ID = "book-signal-at-bellwether";
const FUTURE_EXPIRY = "2026-08-01T00:00:00.000Z";

function originHeaders(method: string): Record<string, string> {
  return method === "GET"
    ? {}
    : {
        origin: TEST_ORIGIN,
        "content-type": "application/json"
      };
}

afterEach(async () => {
  while (testBackendClosers.length > 0) {
    const close = testBackendClosers.pop();
    if (close !== undefined) await close();
  }
});

async function openSeededApp(options?: Readonly<{ now?: () => string }>) {
  return createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig(),
    ...(options?.now === undefined ? {} : { now: options.now })
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
  const captureId = createdBody.head.captureId as string;
  const saved = await app.request(
    `/api/projects/${PROJECT}/captures/${captureId}/body`,
    {
      method: "PATCH",
      headers: originHeaders("PATCH"),
      body: JSON.stringify({
        expectedWorkingVersion: 1,
        document: {
          schemaVersion: 1,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { id: "block-1" },
                content: [{ type: "text", text: "Fog presses the harbor glass." }]
              }
            ]
          }
        }
      })
    }
  );
  expect(saved.status).toBe(200);
  return captureId;
}

async function ensureOpenAiCredential(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  const saved = await app.request("/api/me/provider/openai", {
    method: "PUT",
    headers: originHeaders("PUT"),
    body: JSON.stringify({ apiKey: "sk-grant-route-test-key-1234567890" })
  });
  expect(saved.status).toBe(200);
}

async function createCharacterAssignment(app: Awaited<ReturnType<typeof openSeededApp>>["app"]) {
  await ensureOpenAiCredential(app);
  const created = await app.request(`/api/projects/${PROJECT}/story-work/assignments`, {
    method: "POST",
    headers: originHeaders("POST"),
    body: JSON.stringify({
      taskKind: "character",
      idempotencyKey: `grant-route-${randomUUID()}`,
      expectedProjectVersion: 1,
      brief: "Grant route assignment brief.",
      constraints: "Keep canon intact.",
      doneWhen: "A dossier is ready for review.",
      sceneIds: [],
      model: "gpt-4.1"
    })
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  return body.assignment.id as string;
}

function grantPostBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    expiresAt: FUTURE_EXPIRY,
    ...overrides
  });
}

describe("MCP grant admin routes", () => {
  it("creates, lists, and revokes a project-scoped grant without leaking token material later", async () => {
    const { app } = await openSeededApp();
    const captureId = await createReadyCapture(app);

    const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        sceneIds: [BELLWETHER_SCENE_ID],
        bookIds: [BELLWETHER_BOOK_ID],
        allowProjectStructureRead: true,
        tools: [...MCP_GRANT_TOOL_NAMES]
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(typeof createdBody.token).toBe("string");
    expect(createdBody.token.length).toBeGreaterThanOrEqual(24);
    expect(createdBody.grant.captureIds).toEqual([captureId]);
    expect(createdBody.grant.sceneIds).toEqual([BELLWETHER_SCENE_ID]);
    expect(createdBody.grant.bookIds).toEqual([BELLWETHER_BOOK_ID]);
    expect(createdBody.grant.allowProjectStructureRead).toBe(true);
    expect(createdBody.grant.assignmentIds).toEqual([]);
    expect(createdBody.grant.coordinationIds).toEqual([]);
    expect(createdBody.grant).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(createdBody.grant)).not.toContain(createdBody.token);

    const listed = await app.request(`/api/projects/${PROJECT}/mcp-grants`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.grants).toHaveLength(1);
    expect(listedBody.grants[0].id).toBe(createdBody.grant.id);
    expect(listedBody.grants[0].sceneIds).toEqual([BELLWETHER_SCENE_ID]);
    expect(listedBody.grants[0].allowProjectStructureRead).toBe(true);
    expect(JSON.stringify(listedBody)).not.toContain(createdBody.token);
    expect(listedBody.grants[0]).not.toHaveProperty("token");

    const revoked = await app.request(
      `/api/projects/${PROJECT}/mcp-grants/${createdBody.grant.id}`,
      {
        method: "DELETE",
        headers: originHeaders("DELETE")
      }
    );
    expect(revoked.status).toBe(200);
    const revokedBody = await revoked.json();
    expect(revokedBody.grant.revokedAt).toBeTruthy();

    const missing = await app.request(
      `/api/projects/${PROJECT}/mcp-grants/mcp-grant-does-not-exist`,
      {
        method: "DELETE",
        headers: originHeaders("DELETE")
      }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Not found.",
      code: "NOT_FOUND"
    });
  });

  it("requires auth and trusted origin for grant mutations", async () => {
    const { app } = await createSeededBackendApp(
      {
        handler: () => Response.json({ auth: "handled" }),
        getSession: async () => null,
        ensureDemoCredentialAccount: async () => {},
        signInDemo: async () => Response.json({ ok: true })
      },
      { kekConfig: createTestProviderKekRuntimeConfig() }
    );
    expect((await app.request(`/api/projects/${PROJECT}/mcp-grants`)).status).toBe(
      401
    );

    const authed = await openSeededApp();
    const captureId = await createReadyCapture(authed.app);
    const missingOrigin = await authed.app.request(
      `/api/projects/${PROJECT}/mcp-grants`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: grantPostBody({
          captureIds: [captureId],
          tools: ["ghostwriter_get_grant"]
        })
      }
    );
    expect(missingOrigin.status).toBe(403);
  });

  it("accepts legacy capture-only mint bodies unchanged", async () => {
    const { app } = await openSeededApp();
    const captureId = await createReadyCapture(app);
    const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        tools: [...MCP_GRANT_CAPTURE_TOOL_NAMES, "ghostwriter_get_grant"]
      })
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.grant.captureIds).toEqual([captureId]);
    expect(typeof body.token).toBe("string");
  });

  it("mints story-work grants and round-trips resource fields on list", async () => {
    const { app } = await openSeededApp();
    const assignmentId = await createCharacterAssignment(app);
    const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        sceneIds: [BELLWETHER_SCENE_ID],
        bookIds: [BELLWETHER_BOOK_ID],
        assignmentIds: [assignmentId],
        allowProjectStructureRead: true,
        tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.grant.captureIds).toEqual([]);
    expect(createdBody.grant.sceneIds).toEqual([BELLWETHER_SCENE_ID]);
    expect(createdBody.grant.bookIds).toEqual([BELLWETHER_BOOK_ID]);
    expect(createdBody.grant.assignmentIds).toEqual([assignmentId]);
    expect(createdBody.grant.coordinationIds).toEqual([]);
    expect(createdBody.grant.allowProjectStructureRead).toBe(true);

    const listed = await app.request(`/api/projects/${PROJECT}/mcp-grants`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.grants[0]).toEqual(createdBody.grant);
    expect(listedBody.grants[0]).not.toHaveProperty("token");
  });

  it("accepts mixed capture and story-work resource grants", async () => {
    const { app } = await openSeededApp();
    const captureId = await createReadyCapture(app);
    const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        sceneIds: [BELLWETHER_SCENE_ID],
        allowProjectStructureRead: true,
        tools: [
          "ghostwriter_get_grant",
          "ghostwriter_read_capture",
          "ghostwriter_list_story_work"
        ]
      })
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.grant.captureIds).toEqual([captureId]);
    expect(body.grant.sceneIds).toEqual([BELLWETHER_SCENE_ID]);
  });

  it("rejects empty resource grants and incompatible tool/resource pairings", async () => {
    const { app } = await openSeededApp();

    const emptyResources = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        tools: ["ghostwriter_get_grant"]
      })
    });
    expect(emptyResources.status).toBe(422);
    expect((await emptyResources.json()).code).toBe("INVALID_AGENT_POLICY");

    const storyWithoutStructure = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        sceneIds: [BELLWETHER_SCENE_ID],
        tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
      })
    });
    expect(storyWithoutStructure.status).toBe(422);
    expect((await storyWithoutStructure.json()).code).toBe("INVALID_AGENT_POLICY");

    const captureWithoutCapture = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"]
      })
    });
    expect(captureWithoutCapture.status).toBe(422);
    expect((await captureWithoutCapture.json()).code).toBe("INVALID_AGENT_POLICY");
  });

  it("non-discloses missing scene, book, assignment, and coordination references", async () => {
    const { app } = await openSeededApp();
    const assignmentId = await createCharacterAssignment(app);

    const wrongScene = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        sceneIds: ["scene-not-in-this-project"],
        allowProjectStructureRead: true,
        tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"]
      })
    });
    expect(wrongScene.status).toBe(422);
    expect((await wrongScene.json()).code).toBe("UNKNOWN_REFERENCE");

    const wrongBook = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        bookIds: ["book-not-in-this-project"],
        allowProjectStructureRead: true,
        tools: ["ghostwriter_get_grant"]
      })
    });
    expect(wrongBook.status).toBe(422);
    expect((await wrongBook.json()).code).toBe("UNKNOWN_REFERENCE");

    const wrongAssignment = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        assignmentIds: ["story_work_assignment_missing"],
        allowProjectStructureRead: true,
        tools: ["ghostwriter_get_grant"]
      })
    });
    expect(wrongAssignment.status).toBe(404);
    expect(await wrongAssignment.json()).toEqual({
      error: "Not found.",
      code: "NOT_FOUND"
    });

    const wrongCoordination = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        coordinationIds: ["story_work_coordination_missing"],
        allowProjectStructureRead: true,
        tools: ["ghostwriter_get_grant"]
      })
    });
    expect(wrongCoordination.status).toBe(404);
    expect(await wrongCoordination.json()).toEqual({
      error: "Not found.",
      code: "NOT_FOUND"
    });

    const wrongCapture = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: ["capture-not-in-this-project"],
        tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"]
      })
    });
    expect(wrongCapture.status).toBe(404);
    expect(await wrongCapture.json()).toEqual({
      error: "Not found.",
      code: "NOT_FOUND"
    });

    expect(assignmentId.length).toBeGreaterThan(0);
  });

  it("returns plaintext token only on create and denies revoked or expired tokens at runtime", async () => {
    let now = "2026-07-11T19:00:00.000Z";
    const seeded = await openSeededApp({ now: () => now });
    const captureId = await createReadyCapture(seeded.app);

    const created = await seeded.app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"]
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const token = createdBody.token as string;

    const listed = await seeded.app.request(`/api/projects/${PROJECT}/mcp-grants`);
    expect(JSON.stringify(await listed.json())).not.toContain(token);

    const { mcpGrants } = seeded.agentProvider;
    await expect(mcpGrants.resolveActiveGrantFromToken(token)).resolves.toBeDefined();

    await seeded.app.request(
      `/api/projects/${PROJECT}/mcp-grants/${createdBody.grant.id}`,
      { method: "DELETE", headers: originHeaders("DELETE") }
    );
    await expect(mcpGrants.resolveActiveGrantFromToken(token)).rejects.toBeInstanceOf(
      McpGrantNotFoundError
    );

    now = "2026-07-20T00:00:00.000Z";
    const expiredAttempt = await seeded.app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: grantPostBody({
        captureIds: [captureId],
        tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"],
        expiresAt: "2026-07-25T00:00:00.000Z"
      })
    });
    expect(expiredAttempt.status).toBe(201);
    const expiredBody = await expiredAttempt.json();
    now = "2026-08-01T00:00:00.000Z";
    await expect(
      mcpGrants.resolveActiveGrantFromToken(expiredBody.token as string)
    ).rejects.toBeInstanceOf(McpGrantNotFoundError);
  });
});
