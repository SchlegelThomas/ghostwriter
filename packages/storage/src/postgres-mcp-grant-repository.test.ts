import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  captureId,
  createMcpGrantRecord,
  createProjectMembership,
  mcpGrantId,
  mcpGrantTokenHash
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresMcpGrantRepository } from "./postgres-mcp-grant-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { user } from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER = accountId("account-mcp-grant-postgres");
const NOW = "2026-07-24T23:45:00.000Z";
const LATER = "2026-07-24T23:46:00.000Z";

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function openRepo() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER,
    name: "Grant Owner",
    email: "mcp-grant@example.test",
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  return createPostgresMcpGrantRepository(repositoryDatabase);
}

describe("postgres MCP grant repository", () => {
  it("inserts, looks up by token hash, lists, and revokes", async () => {
    const repo = await openRepo();
    const grant = createMcpGrantRecord({
      id: mcpGrantId("mcp-grant-postgres-1"),
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [captureId("capture-a")],
      tools: ["ghostwriter_get_grant", "ghostwriter_read_capture"],
      tokenHash: mcpGrantTokenHash("d".repeat(64)),
      tokenHint: "…oken",
      expiresAt: "2026-08-01T00:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW
    });

    const inserted = await repo.insert(grant);
    expect(inserted.ok).toBe(true);

    const byHash = await repo.getByTokenHash(grant.tokenHash);
    expect(byHash?.id).toBe(grant.id);

    const listed = await repo.listByProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(listed).toHaveLength(1);

    const revoked = await repo.revoke({
      id: grant.id,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      revokedAt: LATER,
      updatedAt: LATER
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.grant.revokedAt).toBe(LATER);

    const again = await repo.revoke({
      id: grant.id,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      revokedAt: LATER,
      updatedAt: LATER
    });
    expect(again).toEqual({ ok: false, reason: "already-revoked" });
  });
});
