import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  createBookReaderServices,
  createCanvasServices,
  createGhostwriterServices,
  createIdentityServices,
  createSceneWritingServices,
  type DomainIdKind
} from "@ghostwriter/core";
import {
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
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
import type { AuthGateway, AuthenticatedSession } from "./auth.js";

if (process.env.GHOSTWRITER_E2E !== "1") {
  throw new Error("The hermetic E2E server requires GHOSTWRITER_E2E=1.");
}

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
    }
  };
}

const { db, close } = createPgliteDatabase();
await migratePgliteRepositoryDatabase(db);
await db.insert(user).values(account);
const repositoryDatabase = toRepositoryDatabase(db);
const projects = createPostgresProjectRepository(repositoryDatabase);
const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
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
const app = createApp({
  services,
  writing,
  canvas,
  reader,
  identity,
  auth: e2eAuthGateway(),
  allowedOrigins: [appOrigin]
});
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ghostwriter E2E backend listening on port ${info.port}`);
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
