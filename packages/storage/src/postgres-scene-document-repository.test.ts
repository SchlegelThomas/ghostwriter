import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  type ApplyDocumentAsRevisionInput,
  accountId,
  createGhostwriterServices,
  createProjectMembership,
  createSceneWritingServices,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  revisionId,
  sceneContentHash,
  sceneId,
  sceneLeaseHolderId
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  sceneDocuments,
  sceneRevisions,
  sceneVariants,
  user
} from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER_ACCOUNT_ID = accountId("account-scene-owner");
const SCENE_ID = sceneId("scene-arrival-at-bellwether");

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function setup() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER_ACCOUNT_ID,
    name: "Scene Owner",
    email: "scene-owner@example.test",
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER_ACCOUNT_ID,
        role: "owner",
        createdAt: "2026-07-12T18:00:00.000Z"
      })
    );
  });

  let now = "2026-07-12T18:00:00.000Z";
  let nextId = 0;
  const sceneDocumentRepository =
    createPostgresSceneDocumentRepository(repositoryDatabase);
  const writing = createSceneWritingServices({
    projects,
    sceneDocuments: sceneDocumentRepository,
    ids: {
      create(kind) {
        nextId += 1;
        return `${kind}-${nextId}`;
      }
    },
    clock: { now: () => now }
  });

  return {
    db,
    projects,
    sceneDocumentRepository,
    writing,
    setNow(value: string) {
      now = value;
    }
  };
}

function documentWith(text: string, id: string) {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id },
          content: [{ type: "text", text }]
        }
      ]
    }
  } as const;
}

function repositoryDocumentWith(
  text: string,
  id: string
): ApplyDocumentAsRevisionInput["document"] {
  return documentWith(text, id) as unknown as ApplyDocumentAsRevisionInput["document"];
}

const scope = {
  accountId: OWNER_ACCOUNT_ID,
  projectId: BELLWETHER_FIXTURE_PROJECT_ID,
  sceneId: SCENE_ID
};

describe("postgres scene document repository", () => {
  it("serializes racing initialization into one genesis head", async () => {
    const { db, writing } = await setup();

    const [first, second] = await Promise.all([
      writing.getSceneWorkspace(scope),
      writing.getSceneWorkspace(scope)
    ]);

    expect(first.head).toEqual(second.head);
    expect(await db.select().from(sceneDocuments)).toHaveLength(1);
    expect(await db.select().from(sceneRevisions)).toHaveLength(1);
  });

  it("guards saves by exact version, holder, and lease expiry", async () => {
    const { sceneDocumentRepository, writing, setNow } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });

    await expect(
      writing.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-other",
        expectedWorkingVersion: 1,
        document: documentWith("Wrong holder", "block-wrong-holder")
      })
    ).rejects.toBeInstanceOf(SceneLeaseConflictError);

    const saved = await writing.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 1,
      document: documentWith("Durably saved", "block-saved")
    });
    expect(saved.workingVersion).toBe(2);

    await expect(
      writing.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-owner",
        expectedWorkingVersion: 1,
        document: documentWith("Stale overwrite", "block-stale")
      })
    ).rejects.toBeInstanceOf(SceneWorkingVersionConflictError);
    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 2,
      document: documentWith("Durably saved", "block-saved")
    });

    setNow("2026-07-12T18:01:00.001Z");
    await expect(
      writing.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-owner",
        expectedWorkingVersion: 2,
        document: documentWith("Expired overwrite", "block-expired")
      })
    ).rejects.toBeInstanceOf(SceneLeaseExpiredError);
    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 2,
      document: documentWith("Durably saved", "block-saved")
    });
  });

  it("persists checkpoint chains, variants, compare inputs, and restore-as-new", async () => {
    const { db, writing, setNow } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });

    const genesis = await writing.createManualCheckpoint({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 1
    });
    expect(genesis).toMatchObject({
      created: false,
      head: { workingVersion: 1 },
      revision: { reason: "genesis" }
    });

    setNow("2026-07-12T18:00:10.000Z");
    await writing.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 1,
      document: documentWith("First immutable path", "block-path")
    });
    setNow("2026-07-12T18:00:20.000Z");
    const firstCheckpoint = await writing.createManualCheckpoint({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 2
    });
    expect(firstCheckpoint).toMatchObject({
      created: true,
      head: { workingVersion: 3 },
      revision: {
        parentRevisionId: genesis.revision.id,
        actorAccountId: OWNER_ACCOUNT_ID
      }
    });

    setNow("2026-07-12T18:00:30.000Z");
    await writing.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 3,
      document: documentWith("Second immutable path", "block-path")
    });
    setNow("2026-07-12T18:00:40.000Z");
    const firstVariant = await writing.createNamedSceneVariant({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 4,
      name: "  Alternate ending  "
    });
    expect(firstVariant).toMatchObject({
      checkpointCreated: true,
      head: { workingVersion: 5 },
      revision: { parentRevisionId: firstCheckpoint.revision.id },
      variant: {
        name: "Alternate ending",
        creatorAccountId: OWNER_ACCOUNT_ID
      }
    });
    expect(firstVariant.variant.revisionId).toBe(firstVariant.revision.id);

    setNow("2026-07-12T18:00:45.000Z");
    const secondVariant = await writing.createNamedSceneVariant({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 5,
      name: "Editor pass"
    });
    expect(secondVariant).toMatchObject({
      checkpointCreated: false,
      head: { workingVersion: 5 },
      revision: { id: firstVariant.revision.id }
    });
    await expect(
      writing.createNamedSceneVariant({
        ...scope,
        sessionId: "session-owner",
        expectedWorkingVersion: 5,
        name: " Editor pass "
      })
    ).rejects.toBeInstanceOf(SceneVariantNameConflictError);
    expect(await db.select().from(sceneVariants)).toHaveLength(2);

    const comparison = await writing.compareSceneRevisions({
      ...scope,
      beforeRevisionId: firstCheckpoint.revision.id,
      afterRevisionId: firstVariant.revision.id
    });
    expect(comparison).toMatchObject({
      comparison: {
        equal: false,
        blocks: [
          {
            blockId: "block-path",
            changes: ["changed"],
            before: { content: [{ text: "First immutable path" }] },
            after: { content: [{ text: "Second immutable path" }] }
          }
        ]
      }
    });

    setNow("2026-07-12T18:00:50.000Z");
    const restored = await writing.restoreSceneRevision({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 5,
      revisionId: firstCheckpoint.revision.id
    });
    expect(restored).toMatchObject({
      head: {
        workingVersion: 6,
        document: documentWith("First immutable path", "block-path"),
        checkpointRevisionId: restored.revision.id
      },
      revision: {
        parentRevisionId: firstVariant.revision.id,
        contentHash: firstCheckpoint.revision.contentHash,
        actorAccountId: OWNER_ACCOUNT_ID,
        reason: "restore"
      }
    });
    expect(restored.revision.id).not.toBe(firstCheckpoint.revision.id);

    const storedRevisions = await db.select().from(sceneRevisions);
    expect(storedRevisions).toHaveLength(4);
    expect(
      storedRevisions.filter(
        (revision) =>
          revision.contentHash === firstCheckpoint.revision.contentHash
      )
    ).toHaveLength(2);
    const metadata = await writing.listSceneRevisions(scope);
    expect(metadata).toHaveLength(4);
    expect(metadata[0]).not.toHaveProperty("document");

    const reloadedRepository = createPostgresSceneDocumentRepository(
      toRepositoryDatabase(db)
    );
    await expect(reloadedRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 6,
      checkpointRevisionId: restored.revision.id,
      document: documentWith("First immutable path", "block-path")
    });
    await expect(reloadedRepository.listVariants(SCENE_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstVariant.variant.id,
          revisionId: firstVariant.revision.id
        }),
        expect.objectContaining({
          id: secondVariant.variant.id,
          revisionId: firstVariant.revision.id
        })
      ])
    );
    await expect(
      reloadedRepository.getVariant(firstVariant.variant.id)
    ).resolves.toMatchObject({
      sceneId: SCENE_ID,
      revisionId: firstVariant.revision.id,
      name: "Alternate ending"
    });
  });

  it("rolls back checkpoint and variant effects for stale, wrong, and expired leases", async () => {
    const {
      db,
      sceneDocumentRepository,
      writing,
      setNow
    } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });
    await writing.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 1,
      document: documentWith("Uncheckpointed work", "block-uncheckpointed")
    });

    await expect(
      writing.createManualCheckpoint({
        ...scope,
        sessionId: "session-other",
        expectedWorkingVersion: 2
      })
    ).rejects.toBeInstanceOf(SceneLeaseConflictError);
    await expect(
      writing.createManualCheckpoint({
        ...scope,
        sessionId: "session-owner",
        expectedWorkingVersion: 1
      })
    ).rejects.toBeInstanceOf(SceneWorkingVersionConflictError);

    setNow("2026-07-12T18:01:00.001Z");
    await expect(
      writing.createNamedSceneVariant({
        ...scope,
        sessionId: "session-owner",
        expectedWorkingVersion: 2,
        name: "Must not persist"
      })
    ).rejects.toBeInstanceOf(SceneLeaseExpiredError);

    expect(await db.select().from(sceneRevisions)).toHaveLength(1);
    expect(await db.select().from(sceneVariants)).toHaveLength(0);
    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 2,
      document: documentWith("Uncheckpointed work", "block-uncheckpointed")
    });
  });

  it("keeps initialized scene rows stable across metadata commands", async () => {
    const { projects, sceneDocumentRepository, writing } = await setup();
    const workspace = await writing.getSceneWorkspace(scope);
    const metadata = createGhostwriterServices({
      projects,
      ids: {
        create() {
          throw new Error("This command does not create IDs.");
        }
      },
      clock: { now: () => "2026-07-12T18:00:30.000Z" }
    });

    await metadata.executeProjectCommand({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      expectedVersion: 1,
      command: { type: "project.rename", title: "Stable Scene Rows" }
    });

    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toEqual(
      workspace.head
    );
    await expect(
      sceneDocumentRepository.getRevision(workspace.head.checkpointRevisionId)
    ).resolves.toMatchObject({ reason: "genesis", sceneId: SCENE_ID });
  });

  it("batch-reads scene heads in one query", async () => {
    const { sceneDocumentRepository, writing } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });
    await writing.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-owner",
      expectedWorkingVersion: 1,
      document: documentWith("Batch read", "block-batch")
    });
    const heads = await sceneDocumentRepository.getHeads([
      SCENE_ID,
      sceneId("scene-not-in-this-project")
    ]);
    expect(heads.size).toBe(1);
    expect(heads.get(SCENE_ID)).toMatchObject({
      workingVersion: 2,
      document: documentWith("Batch read", "block-batch")
    });
  });

  it("applies reviewed agent prose as one immutable revision and head advance", async () => {
    const { db, sceneDocumentRepository, writing } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });
    const original = await sceneDocumentRepository.getHead(SCENE_ID);
    if (original === undefined) throw new Error("Expected initialized scene head.");
    const appliedId = revisionId("revision-postgres-agent-applied");
    const appliedDocument = repositoryDocumentWith(
      "Reviewed agent prose",
      "block-agent-applied"
    );
    const appliedHash = sceneContentHash("b".repeat(64));

    const result = await sceneDocumentRepository.applyDocumentAsRevision({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID,
      holderId: sceneLeaseHolderId("session-owner"),
      expectedWorkingVersion: 1,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T18:00:30.000Z",
      revisionId: appliedId,
      document: appliedDocument,
      contentHash: appliedHash
    });

    expect(result).toMatchObject({
      ok: true,
      head: {
        workingVersion: 2,
        document: appliedDocument,
        contentHash: appliedHash,
        checkpointRevisionId: appliedId
      },
      revision: {
        id: appliedId,
        parentRevisionId: original.checkpointRevisionId,
        origin: "agent",
        reason: "agent-apply"
      }
    });
    expect(await db.select().from(sceneRevisions)).toHaveLength(2);
    await expect(
      sceneDocumentRepository.getRevision(original.checkpointRevisionId)
    ).resolves.toMatchObject({
      document: original.document,
      contentHash: original.contentHash,
      reason: "genesis"
    });

    await expect(
      sceneDocumentRepository.applyDocumentAsRevision({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        sceneId: SCENE_ID,
        holderId: sceneLeaseHolderId("session-owner"),
        expectedWorkingVersion: 2,
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:00:40.000Z",
        revisionId: appliedId,
        document: repositoryDocumentWith("Must roll back", "block-rollback"),
        contentHash: sceneContentHash("c".repeat(64))
      })
    ).rejects.toBeDefined();
    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 2,
      document: appliedDocument,
      checkpointRevisionId: appliedId
    });
    expect(await db.select().from(sceneRevisions)).toHaveLength(2);
  });

  it("refuses agent apply for stale version, wrong holder, and expired lease", async () => {
    const { db, sceneDocumentRepository, writing } = await setup();
    await writing.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-owner"
    });
    const base = {
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID,
      actorAccountId: OWNER_ACCOUNT_ID,
      revisionId: revisionId("revision-postgres-agent-refused"),
      document: repositoryDocumentWith(
        "Refused agent prose",
        "block-agent-refused"
      ),
      contentHash: sceneContentHash("d".repeat(64))
    };

    await expect(
      sceneDocumentRepository.applyDocumentAsRevision({
        ...base,
        holderId: sceneLeaseHolderId("session-owner"),
        expectedWorkingVersion: 2,
        now: "2026-07-12T18:00:30.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "working-version-conflict" });
    await expect(
      sceneDocumentRepository.applyDocumentAsRevision({
        ...base,
        holderId: sceneLeaseHolderId("session-other"),
        expectedWorkingVersion: 1,
        now: "2026-07-12T18:00:30.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "lease-conflict" });
    await expect(
      sceneDocumentRepository.applyDocumentAsRevision({
        ...base,
        holderId: sceneLeaseHolderId("session-owner"),
        expectedWorkingVersion: 1,
        now: "2026-07-12T18:01:00.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "lease-expired" });
    await expect(sceneDocumentRepository.getHead(SCENE_ID)).resolves.toMatchObject({
      workingVersion: 1
    });
    expect(await db.select().from(sceneRevisions)).toHaveLength(1);
  });
});
