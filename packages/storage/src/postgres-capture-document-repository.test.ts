import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  accountId,
  captureContentHash,
  captureRevisionId,
  createCaptureRevision,
  createCaptureServices,
  createInitialCaptureDocumentState,
  createProjectMembership,
  projectId,
  sceneId,
  type CaptureContentHash,
  type CaptureDocumentHead
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { captureRevisions, captures, user } from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER_ACCOUNT_ID = accountId("account-capture-owner");
const OTHER_PROJECT_ID = projectId("project-other-capture");

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
    name: "Capture Owner",
    email: "capture-owner@example.test",
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
  const captureDocuments =
    createPostgresCaptureDocumentRepository(repositoryDatabase);
  const services = createCaptureServices({
    projects,
    captureDocuments,
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
    captureDocuments,
    services,
    setNow(value: string) {
      now = value;
    }
  };
}

function documentWith(text: string, blockId = "block-capture-pg-1") {
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
  } as const;
}

function repositoryTestHash(seed: number): CaptureContentHash {
  return captureContentHash(seed.toString(16).padStart(64, "0"));
}

function repositoryDocument(
  text: string,
  blockId: string
): CaptureDocumentHead["document"] {
  return documentWith(text, blockId) as unknown as CaptureDocumentHead["document"];
}

const scope = {
  accountId: OWNER_ACCOUNT_ID,
  projectId: BELLWETHER_FIXTURE_PROJECT_ID
};

describe("postgres capture document repository", () => {
  it("applies capture migrations from an empty database", async () => {
    const { db } = await setup();
    expect(await db.select().from(captures)).toEqual([]);
    expect(await db.select().from(captureRevisions)).toEqual([]);
  });

  it("creates, reads, lists, and persists genesis revisions", async () => {
    const { captureDocuments, services } = await setup();

    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    expect(await services.listCaptures(scope)).toEqual([]);

    const loaded = await captureDocuments.get(created.captureId);
    expect(loaded).toEqual(created);

    const genesis = await captureDocuments.getRevision(created.genesisRevisionId);
    expect(genesis).toMatchObject({
      reason: "genesis",
      origin: "system",
      captureId: created.captureId
    });

    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Persisted note.")
    });

    const listed = await services.listCaptures(scope);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("document");
    expect(listed[0]?.workingVersion).toBe(2);
  });

  it("omits untouched empty genesis captures from default list", async () => {
    const { services } = await setup();
    await services.createCapture({ ...scope, sourceModality: "dictation" });
    expect(await services.listCaptures(scope)).toEqual([]);
  });

  it("acknowledges optimistic saves with a version bump", async () => {
    const { captureDocuments, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    const document = repositoryDocument("Saved once.", "block-capture-pg-saved");
    const outcome = await captureDocuments.saveWorkingDocument({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document,
      contentHash: repositoryTestHash(1),
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T18:05:00.000Z"
    });
    expect(outcome).toEqual({
      ok: true,
      head: expect.objectContaining({ workingVersion: 2 })
    });
  });

  it("lets only one concurrent save win for the same expected version", async () => {
    const { captureDocuments, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    const firstDocument = repositoryDocument("Race A", "block-race-a");
    const secondDocument = repositoryDocument("Race B", "block-race-b");
    const [first, second] = await Promise.all([
      captureDocuments.saveWorkingDocument({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        expectedWorkingVersion: 1,
        document: firstDocument,
        contentHash: repositoryTestHash(2),
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:06:00.000Z"
      }),
      captureDocuments.saveWorkingDocument({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        expectedWorkingVersion: 1,
        document: secondDocument,
        contentHash: repositoryTestHash(3),
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:06:00.000Z"
      })
    ]);

    const winners = [first, second].filter((outcome) => outcome.ok);
    const losers = [first, second].filter((outcome) => !outcome.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([
      { ok: false, reason: "working-version-conflict" }
    ]);
    expect(await captureDocuments.get(created.captureId)).toMatchObject({
      workingVersion: 2
    });
  });

  it("returns version conflict for project mismatches without leaking content", async () => {
    const { captureDocuments, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    const document = repositoryDocument("Wrong project.", "block-wrong-project");
    const outcome = await captureDocuments.saveWorkingDocument({
      projectId: OTHER_PROJECT_ID,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document,
      contentHash: repositoryTestHash(4),
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T18:07:00.000Z"
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "working-version-conflict"
    });
    expect(await captureDocuments.get(created.captureId)).toMatchObject({
      workingVersion: 1
    });
  });

  it("archives and restores with stable timestamps", async () => {
    const { captureDocuments, services, setNow } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Archive me.")
    });

    setNow("2026-07-12T19:00:00.000Z");
    const archived = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: true,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T19:00:00.000Z"
    });
    expect(archived).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "archived",
        archivedAt: "2026-07-12T19:00:00.000Z"
      })
    });
    expect(await services.listCaptures(scope)).toEqual([]);
    expect(
      await services.listCaptures({ ...scope, includeArchived: true })
    ).toHaveLength(1);

    setNow("2026-07-12T20:00:00.000Z");
    const restored = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: false,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T20:00:00.000Z"
    });
    expect(restored).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "draft",
        updatedAt: "2026-07-12T20:00:00.000Z"
      })
    });
    expect(restored.ok && restored.head.archivedAt).toBeUndefined();
  });

  it("re-acknowledges idempotent archive and restore with fresh returned writes", async () => {
    const { captureDocuments, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Idempotent archive.")
    });

    const firstArchive = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: true,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T19:00:00.000Z"
    });
    const secondArchive = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: true,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T19:30:00.000Z"
    });
    expect(firstArchive).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "archived",
        archivedAt: "2026-07-12T19:00:00.000Z",
        updatedAt: "2026-07-12T19:00:00.000Z"
      })
    });
    expect(secondArchive).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "archived",
        archivedAt: "2026-07-12T19:30:00.000Z",
        updatedAt: "2026-07-12T19:30:00.000Z"
      })
    });

    const firstRestore = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: false,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T20:00:00.000Z"
    });
    const secondRestore = await captureDocuments.setArchived({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: created.captureId,
      archived: false,
      actorAccountId: OWNER_ACCOUNT_ID,
      now: "2026-07-12T20:30:00.000Z"
    });
    expect(firstRestore).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "draft",
        updatedAt: "2026-07-12T20:00:00.000Z"
      })
    });
    expect(firstRestore.ok && firstRestore.head.archivedAt).toBeUndefined();
    expect(secondRestore).toEqual({
      ok: true,
      head: expect.objectContaining({
        status: "draft",
        updatedAt: "2026-07-12T20:30:00.000Z"
      })
    });
    expect(secondRestore.ok && secondRestore.head.archivedAt).toBeUndefined();
  });

  it("returns acknowledged writes under concurrent archive and restore races", async () => {
    const { captureDocuments, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Race archive restore.")
    });

    const archiveNow = "2026-07-12T21:00:00.000Z";
    const restoreNow = "2026-07-12T21:00:01.000Z";
    const [archiveOutcome, restoreOutcome] = await Promise.all([
      captureDocuments.setArchived({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        archived: true,
        actorAccountId: OWNER_ACCOUNT_ID,
        now: archiveNow
      }),
      captureDocuments.setArchived({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        archived: false,
        actorAccountId: OWNER_ACCOUNT_ID,
        now: restoreNow
      })
    ]);

    for (const outcome of [archiveOutcome, restoreOutcome]) {
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      if (outcome.head.updatedAt === archiveNow) {
        expect(outcome.head).toMatchObject({
          status: "archived",
          archivedAt: archiveNow
        });
      } else {
        expect(outcome.head).toMatchObject({
          status: "draft",
          updatedAt: restoreNow
        });
        expect(outcome.head.archivedAt).toBeUndefined();
      }
    }

    const finalHead = await captureDocuments.get(created.captureId);
    expect(finalHead).toBeDefined();
    if (finalHead?.status === "archived") {
      expect(finalHead.archivedAt).toBe(archiveNow);
      expect(finalHead.updatedAt).toBe(archiveNow);
    } else {
      expect(finalHead).toMatchObject({
        status: "draft",
        updatedAt: restoreNow
      });
      expect(finalHead?.archivedAt).toBeUndefined();
    }
  });

  it("refuses integrated capture mutations", async () => {
    const { captureDocuments, db, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await db
      .update(captures)
      .set({
        status: "integrated",
        integrationRevisionId: created.genesisRevisionId,
        integratedSceneId: BELLWETHER_FIXTURE.scenes[0]!.id,
        integratedAt: "2026-07-12T18:08:00.000Z",
        integratedByAccountId: OWNER_ACCOUNT_ID
      })
      .where(eq(captures.captureId, created.captureId));

    const document = repositoryDocument("Should fail.", "block-integrated-fail");
    expect(
      await captureDocuments.saveWorkingDocument({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        expectedWorkingVersion: 1,
        document,
        contentHash: repositoryTestHash(5),
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:08:00.000Z"
      })
    ).toEqual({ ok: false, reason: "capture-integrated" });

    expect(
      await captureDocuments.setArchived({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId,
        archived: true,
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:08:00.000Z"
      })
    ).toEqual({ ok: false, reason: "capture-integrated" });
  });

  it("rolls back integration revision insert when head update fails", async () => {
    const { captureDocuments, db, services } = await setup();
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    const capture = await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Integrate rollback probe.")
    });
    const integrationRevision = createCaptureRevision({
      id: captureRevisionId("captureRevision-integrate-rollback"),
      captureId: capture.captureId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      parentRevisionId: capture.genesisRevisionId,
      document: capture.document,
      contentHash: capture.contentHash,
      actorAccountId: OWNER_ACCOUNT_ID,
      origin: "human",
      reason: "integration",
      createdAt: "2026-07-12T18:10:00.000Z"
    });

    await expect(
      captureDocuments.integrate({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        expectedWorkingVersion: capture.workingVersion,
        expectedContentHash: capture.contentHash,
        integrationRevision,
        integratedSceneId: sceneId("scene-missing-for-integrate"),
        actorAccountId: OWNER_ACCOUNT_ID,
        now: "2026-07-12T18:10:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "UNKNOWN_REFERENCE"
    });

    expect(await db.select().from(captureRevisions)).toHaveLength(1);
    expect(await captureDocuments.get(capture.captureId)).toMatchObject({
      status: "draft",
      workingVersion: 2
    });
    expect(
      (await captureDocuments.get(capture.captureId))?.integrationRevisionId
    ).toBeUndefined();
    expect(
      await captureDocuments.getRevision(integrationRevision.id)
    ).toBeUndefined();
  });

  it("serializes racing initialization into one genesis head", async () => {
    const { captureDocuments, db } = await setup();
    const initial = await createInitialCaptureDocumentState({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      actorAccountId: OWNER_ACCOUNT_ID,
      sourceModality: "text",
      ids: {
        create(kind) {
          return `${kind}-race-init`;
        }
      },
      now: "2026-07-12T18:00:00.000Z"
    });

    const [first, second] = await Promise.all([
      captureDocuments.initialize(initial),
      captureDocuments.initialize(initial)
    ]);
    expect(first).toEqual(second);
    expect(await db.select().from(captures)).toHaveLength(1);
    expect(await db.select().from(captureRevisions)).toHaveLength(1);
  });
});
