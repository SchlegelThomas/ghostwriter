import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  createProjectMembership,
  createGhostwriterServices,
  createIdentityServices,
  createMemoryWriterProfileRepository
} from "@ghostwriter/core";
import {
  createPostgresProjectRepository,
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
  const repository = createPostgresProjectRepository(toRepositoryDatabase(db));
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
  const services = createGhostwriterServices({
    projects: repository,
    ids: {
      create: (kind) => {
        nextId += 1;
        return `${kind}-test-${nextId}`;
      }
    },
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });
  const identity = createIdentityServices({
    profiles: createMemoryWriterProfileRepository(),
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });

  return createApp({
    services,
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

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ projects: [] });
    expect(project.status).toBe(404);
    await expect(project.json()).resolves.toEqual({ error: "Project not found." });
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
});
