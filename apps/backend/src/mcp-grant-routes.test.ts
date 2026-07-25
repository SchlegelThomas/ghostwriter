import { afterEach, describe, expect, it } from "vitest";
import { BELLWETHER_FIXTURE_PROJECT_ID, MCP_GRANT_TOOL_NAMES } from "@ghostwriter/core";
import { createTestProviderKekRuntimeConfig } from "./provider-kek-config.js";
import {
  createSeededBackendApp,
  TEST_BACKEND_ORIGIN,
  testBackendClosers
} from "./test-backend-app.js";

const TEST_ORIGIN = TEST_BACKEND_ORIGIN;
const PROJECT = BELLWETHER_FIXTURE_PROJECT_ID;

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

async function openSeededApp() {
  return createSeededBackendApp(undefined, {
    kekConfig: createTestProviderKekRuntimeConfig()
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

describe("MCP grant admin routes", () => {
  it("creates, lists, and revokes a project-scoped grant without leaking token material later", async () => {
    const { app } = await openSeededApp();
    const captureId = await createReadyCapture(app);

    const created = await app.request(`/api/projects/${PROJECT}/mcp-grants`, {
      method: "POST",
      headers: originHeaders("POST"),
      body: JSON.stringify({
        captureIds: [captureId],
        tools: [...MCP_GRANT_TOOL_NAMES],
        expiresAt: "2026-08-01T00:00:00.000Z"
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(typeof createdBody.token).toBe("string");
    expect(createdBody.token.length).toBeGreaterThanOrEqual(24);
    expect(createdBody.grant.captureIds).toEqual([captureId]);
    expect(createdBody.grant).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(createdBody.grant)).not.toContain(createdBody.token);

    const listed = await app.request(`/api/projects/${PROJECT}/mcp-grants`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.grants).toHaveLength(1);
    expect(listedBody.grants[0].id).toBe(createdBody.grant.id);
    expect(JSON.stringify(listedBody)).not.toContain(createdBody.token);

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
        getSession: async () => null
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
        body: JSON.stringify({
          captureIds: [captureId],
          tools: ["ghostwriter_get_grant"],
          expiresAt: "2026-08-01T00:00:00.000Z"
        })
      }
    );
    expect(missingOrigin.status).toBe(403);
  });
});
