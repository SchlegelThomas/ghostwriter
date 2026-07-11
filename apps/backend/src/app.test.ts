import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_NAVIGATOR,
  BELLWETHER_FIXTURE_PROJECT_ID,
  createGhostwriterServices
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
import { createApp } from "./app.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function seededApp() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  const repository = createPostgresProjectRepository(toRepositoryDatabase(db));
  await seedProject(repository, BELLWETHER_FIXTURE);
  const services = createGhostwriterServices({
    projects: repository,
    ids: { create: () => "unused" },
    clock: { now: () => "2026-07-11T19:00:00.000Z" }
  });

  return createApp({ services });
}

describe("backend app", () => {
  it("reports health", async () => {
    const app = await seededApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
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
