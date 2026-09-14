import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  captureId,
  createMcpGrantRecord,
  createProjectMembership,
  mcpGrantId,
  mcpGrantTokenHash,
  storyWorkAssignmentId,
  storyWorkCoordinationId
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
const LEGACY_GRANT = mcpGrantId("mcp-grant-postgres-legacy");
const FULL_GRANT = mcpGrantId("mcp-grant-postgres-full");
const STORY_GRANT = mcpGrantId("mcp-grant-postgres-story");

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
  return {
    db,
    repo: createPostgresMcpGrantRepository(repositoryDatabase)
  };
}

describe("postgres MCP grant repository", () => {
  it("inserts, looks up by token hash, lists, and revokes capture grants", async () => {
    const { repo } = await openRepo();
    const grant = createMcpGrantRecord({
      id: mcpGrantId("mcp-grant-postgres-1"),
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [captureId("capture-a")],
      sceneIds: [],
      bookIds: [],
      assignmentIds: [],
      coordinationIds: [],
      allowProjectStructureRead: false,
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

  it("applies migration 0030 from empty and reads legacy-shaped rows with resource defaults", async () => {
    const { db, repo } = await openRepo();
    await db.execute(sql`
      INSERT INTO mcp_grants (
        id, account_id, project_id, capture_ids, tools,
        token_hash, token_hint, expires_at, created_at, updated_at
      ) VALUES (
        ${LEGACY_GRANT},
        ${OWNER},
        ${BELLWETHER_FIXTURE_PROJECT_ID},
        ${JSON.stringify(["capture-legacy"])}::jsonb,
        ${JSON.stringify(["ghostwriter_get_grant", "ghostwriter_read_capture"])}::jsonb,
        ${"e".repeat(64)},
        '…gacy',
        '2026-08-01T00:00:00.000Z',
        ${NOW},
        ${NOW}
      )
    `);

    const loaded = await repo.getById(LEGACY_GRANT);
    expect(loaded).toMatchObject({
      id: LEGACY_GRANT,
      captureIds: [captureId("capture-legacy")],
      sceneIds: [],
      bookIds: [],
      assignmentIds: [],
      coordinationIds: [],
      allowProjectStructureRead: false
    });
  });

  it("roundtrips story-work and mixed resource grants with frozen fields", async () => {
    const { repo } = await openRepo();
    const scene = BELLWETHER_FIXTURE.scenes[0]!.id;
    const book = BELLWETHER_FIXTURE.books[0]!.id;
    const storyOnly = createMcpGrantRecord({
      id: STORY_GRANT,
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [],
      sceneIds: [scene],
      bookIds: [],
      assignmentIds: [],
      coordinationIds: [],
      tools: ["ghostwriter_get_grant", "ghostwriter_list_story_work"],
      allowProjectStructureRead: true,
      tokenHash: mcpGrantTokenHash("f".repeat(64)),
      tokenHint: "…tory",
      expiresAt: "2026-08-01T00:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW
    });
    expect((await repo.insert(storyOnly)).ok).toBe(true);
    const reloadedStory = await repo.getById(STORY_GRANT);
    expect(reloadedStory).toEqual(storyOnly);

    const mixed = createMcpGrantRecord({
      id: FULL_GRANT,
      accountId: OWNER,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureIds: [captureId("capture-mixed")],
      sceneIds: [scene],
      bookIds: [book],
      assignmentIds: [storyWorkAssignmentId("assignment-grant-mixed")],
      coordinationIds: [storyWorkCoordinationId("coordination-grant-mixed")],
      allowProjectStructureRead: true,
      tools: [
        "ghostwriter_get_grant",
        "ghostwriter_read_capture",
        "ghostwriter_list_story_work_coordinations"
      ],
      tokenHash: mcpGrantTokenHash("a".repeat(64)),
      tokenHint: "…ixed",
      expiresAt: "2026-08-02T00:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW
    });
    expect((await repo.insert(mixed)).ok).toBe(true);
    const reloadedMixed = await repo.getById(FULL_GRANT);
    expect(reloadedMixed).toEqual(mixed);
    expect(reloadedMixed?.sceneIds).toEqual([scene]);
    expect(reloadedMixed?.bookIds).toEqual([book]);
  });
});
