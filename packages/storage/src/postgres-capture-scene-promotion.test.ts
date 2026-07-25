import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CanvasNotFoundError,
  CanvasVersionConflictError,
  CaptureArchivedMutationError,
  CaptureContentHashMismatchError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CapturePromotionNotEligibleError,
  CaptureVersionConflictError,
  ProjectCommandError,
  ProjectVersionConflictError,
  accountId,
  bookId,
  captureContentHash,
  captureId,
  chapterId,
  createCanvasBoard,
  createCapturePromotionServices,
  createCaptureServices,
  createInitialCaptureDocumentState,
  createInitialCanvas,
  createProjectMembership,
  type CaptureScenePromotionUnitOfWork,
  type PromoteCaptureToSceneInput
} from "@ghostwriter/core";
import { sql } from "drizzle-orm";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresCanvasRepository } from "./postgres-canvas-repository.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresCaptureScenePromotionUnitOfWork } from "./postgres-capture-scene-promotion.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { createPostgresSceneDocumentRepository } from "./postgres-scene-document-repository.js";
import {
  canvasObjects,
  canvasRevisions,
  captureRevisions,
  captures,
  scenes,
  user
} from "./schema.js";
import { seedProject } from "./seed.js";

const OWNER = accountId("account-postgres-promotion-owner");
const OTHER = accountId("account-postgres-promotion-other");
const PROJECT_ID = BELLWETHER_FIXTURE_PROJECT_ID;
const SIGNAL_BOOK_ID = bookId("book-signal-at-bellwether");
const LOW_TIDE_CHAPTER_ID = chapterId("chapter-low-tide");
const NOW = "2026-07-24T18:00:00.000Z";
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

function documentWith(text: string, blockId = "block-pg-promo-1") {
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

async function setup(
  unitOfWorkDecorator?: (
    unitOfWork: CaptureScenePromotionUnitOfWork
  ) => CaptureScenePromotionUnitOfWork
) {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values([
    {
      id: OWNER,
      name: "Promotion Owner",
      email: "promotion-owner@example.test",
      emailVerified: true
    },
    {
      id: OTHER,
      name: "Promotion Other",
      email: "promotion-other@example.test",
      emailVerified: true
    }
  ]);
  const repositoryDatabase = toRepositoryDatabase(db);
  const projects = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projects, BELLWETHER_FIXTURE);
  await projects.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    );
  });
  const captureDocuments = createPostgresCaptureDocumentRepository(repositoryDatabase);
  const sceneDocuments = createPostgresSceneDocumentRepository(repositoryDatabase);
  const canvases = createPostgresCanvasRepository(repositoryDatabase);
  let sequence = 0;
  const ids = {
    create(kind: string) {
      sequence += 1;
      return `${kind}-pg-promo-${sequence}`;
    }
  };
  let now = NOW;
  const baseUnitOfWork =
    createPostgresCaptureScenePromotionUnitOfWork(repositoryDatabase);
  const promotion = unitOfWorkDecorator?.(baseUnitOfWork) ?? baseUnitOfWork;
  const captureServices = createCaptureServices({
    projects,
    captureDocuments,
    ids,
    clock: { now: () => now }
  });
  const promotionServices = createCapturePromotionServices({
    projects,
    captureDocuments,
    canvases,
    promotion,
    ids,
    clock: { now: () => now }
  });

  return {
    db,
    projects,
    captureDocuments,
    sceneDocuments,
    canvases,
    captureServices,
    promotionServices,
    setNow(value: string) {
      now = value;
    }
  };
}

async function acknowledgedCapture(
  captureServices: Awaited<ReturnType<typeof setup>>["captureServices"]
) {
  const created = await captureServices.createCapture({
    accountId: OWNER,
    projectId: PROJECT_ID,
    sourceModality: "text"
  });
  return captureServices.saveCaptureDocument({
    accountId: OWNER,
    projectId: PROJECT_ID,
    captureId: created.captureId,
    expectedWorkingVersion: 1,
    document: documentWith("Promoted lighthouse note.", "block-pg-promo-stable")
  });
}

function basePromotionInput(
  capture: Awaited<ReturnType<typeof acknowledgedCapture>>,
  overrides: Partial<PromoteCaptureToSceneInput> = {}
): PromoteCaptureToSceneInput {
  return {
    accountId: OWNER,
    projectId: PROJECT_ID,
    captureId: capture.captureId,
    expectedCaptureWorkingVersion: capture.workingVersion,
    expectedCaptureContentHash: capture.contentHash,
    expectedProjectVersion: 1,
    title: "From the inbox",
    manuscriptPlacement: {
      kind: "unassigned",
      bookId: SIGNAL_BOOK_ID
    },
    ...overrides
  };
}

async function initializeProjectCanvas(
  canvases: Awaited<ReturnType<typeof setup>>["canvases"]
) {
  return canvases.initialize(
    await createInitialCanvas({
      projectId: PROJECT_ID,
      actorAccountId: OWNER,
      now: NOW
    })
  );
}

describe("postgres capture scene promotion unit of work", () => {
  it("applies capture integration migrations from an empty database", async () => {
    const { db } = await setup();
    expect(await db.select().from(captures)).toEqual([]);
    const columns = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'captures'
        AND column_name IN (
          'integration_revision_id',
          'integrated_scene_id',
          'integrated_at',
          'integrated_by_account_id'
        )
      ORDER BY column_name
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "integrated_at",
      "integrated_by_account_id",
      "integrated_scene_id",
      "integration_revision_id"
    ]);
  });

  it("enforces deferrable capture genesis and capture_id foreign keys", async () => {
    const { db, captureDocuments } = await setup();
    const constraints = await db.execute(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'captures_genesis_revision_id_capture_revisions_id_fk',
        'capture_revisions_capture_id_captures_capture_id_fk'
      )
      ORDER BY conname
    `);
    expect(constraints.rows).toEqual([
      expect.objectContaining({
        conname: "capture_revisions_capture_id_captures_capture_id_fk",
        definition: expect.stringContaining("DEFERRABLE")
      }),
      expect.objectContaining({
        conname: "captures_genesis_revision_id_capture_revisions_id_fk",
        definition: expect.stringContaining("DEFERRABLE")
      })
    ]);

    const initial = await createInitialCaptureDocumentState({
      projectId: PROJECT_ID,
      actorAccountId: OWNER,
      sourceModality: "text",
      ids: { create: (kind) => `${kind}-fk-bootstrap` },
      now: NOW
    });
    const bootstrapped = await captureDocuments.initialize(initial);
    expect(await db.select().from(captures)).toHaveLength(1);
    expect(await db.select().from(captureRevisions)).toHaveLength(1);
    expect(await captureDocuments.get(bootstrapped.captureId)).toEqual(bootstrapped);
  });

  it("promotes to unassigned scene without touching Canvas", async () => {
    const { captureServices, promotionServices, projects, canvases, sceneDocuments } =
      await setup();
    const capture = await acknowledgedCapture(captureServices);
    const sceneCountBefore = (await projects.listScenes(PROJECT_ID)).length;

    const result = await promotionServices.promoteCaptureToScene(
      basePromotionInput(capture)
    );

    expect(result).toMatchObject({
      scene: { title: "From the inbox", bookId: SIGNAL_BOOK_ID },
      sceneDocumentHead: { workingVersion: 1 },
      captureHead: {
        status: "integrated",
        integratedSceneId: result.scene.id
      },
      navigator: { version: 2 }
    });
    expect(result.canvas).toBeUndefined();
    expect(await projects.listScenes(PROJECT_ID)).toHaveLength(sceneCountBefore + 1);
    expect(await canvases.getBoard(PROJECT_ID)).toBeUndefined();
    await expect(sceneDocuments.getHead(result.scene.id)).resolves.toMatchObject({
      sceneId: result.scene.id,
      document: capture.document
    });
  });

  it("promotes into a chapter with optional Canvas card on the same SceneId", async () => {
    const { captureServices, promotionServices, canvases } = await setup();
    const capture = await acknowledgedCapture(captureServices);
    await initializeProjectCanvas(canvases);
    const result = await promotionServices.promoteCaptureToScene(
      basePromotionInput(capture, {
        title: "Chapter promotion",
        manuscriptPlacement: {
          kind: "chapter",
          bookId: SIGNAL_BOOK_ID,
          chapterId: LOW_TIDE_CHAPTER_ID
        },
        expectedCanvasVersion: 1,
        canvas: {
          x: 120,
          y: 80,
          width: 240,
          height: 160,
          z: 3,
          storyOrderHint: 5
        }
      })
    );

    const board = await canvases.getBoard(PROJECT_ID);
    expect(board?.version).toBe(2);
    expect(board?.objects).toEqual([
      expect.objectContaining({
        kind: "scene-card",
        sceneId: result.scene.id,
        storyOrderHint: 5
      })
    ]);
  });

  it("preserves exact prose, hash, and block IDs in scene genesis and integration revision", async () => {
    const { captureServices, promotionServices, captureDocuments, sceneDocuments } =
      await setup();
    const capture = await acknowledgedCapture(captureServices);

    const result = await promotionServices.promoteCaptureToScene(
      basePromotionInput(capture, { title: "Lossless promotion" })
    );

    const sceneHead = await sceneDocuments.getHead(result.scene.id);
    const sceneRevision = await sceneDocuments.getRevision(
      sceneHead!.checkpointRevisionId
    );
    expect(sceneRevision).toMatchObject({
      reason: "capture-promotion",
      origin: "human",
      contentHash: sceneHead?.contentHash,
      document: capture.document
    });
    expect(sceneHead?.document.document.content?.[0]).toMatchObject({
      attrs: { id: "block-pg-promo-stable" }
    });
    expect(sceneHead?.contentHash).toBe(capture.contentHash);

    const integrationRevision = await captureDocuments.getRevision(
      result.captureHead.integrationRevisionId!
    );
    expect(integrationRevision).toMatchObject({
      reason: "integration",
      origin: "human",
      parentRevisionId: capture.genesisRevisionId,
      contentHash: capture.contentHash,
      document: capture.document
    });
  });

  it("applies nothing on project, capture, and canvas version conflicts", async () => {
    const { captureServices, promotionServices, projects, canvases } = await setup();
    const capture = await acknowledgedCapture(captureServices);
    const sceneCount = (await projects.listScenes(PROJECT_ID)).length;
    await initializeProjectCanvas(canvases);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, { expectedProjectVersion: 99 })
      )
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
    expect(await projects.listScenes(PROJECT_ID)).toHaveLength(sceneCount);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, { expectedCaptureWorkingVersion: 1 })
      )
    ).rejects.toBeInstanceOf(CaptureVersionConflictError);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, {
          expectedCanvasVersion: 99,
          canvas: { x: 0, y: 0, width: 100, height: 80, z: 1 }
        })
      )
    ).rejects.toBeInstanceOf(CanvasVersionConflictError);
  });

  it("refuses Canvas promotion without initializing a board and applies nothing", async () => {
    const { captureServices, promotionServices, projects, sceneDocuments, canvases } =
      await setup();
    const capture = await acknowledgedCapture(captureServices);
    const sceneCount = (await projects.listScenes(PROJECT_ID)).length;
    const captureBefore = await captureServices.getCapture({
      accountId: OWNER,
      projectId: PROJECT_ID,
      captureId: capture.captureId
    });

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, {
          expectedCanvasVersion: 1,
          canvas: { x: 0, y: 0, width: 100, height: 80, z: 1 }
        })
      )
    ).rejects.toBeInstanceOf(CanvasNotFoundError);

    expect(await canvases.getBoard(PROJECT_ID)).toBeUndefined();
    expect(await projects.listScenes(PROJECT_ID)).toHaveLength(sceneCount);
    expect(await projects.getProject(PROJECT_ID)).toMatchObject({ version: 1 });
    expect(
      await captureServices.getCapture({
        accountId: OWNER,
        projectId: PROJECT_ID,
        captureId: capture.captureId
      })
    ).toEqual(captureBefore);
    const heads = await sceneDocuments.getHeads(
      (await projects.listScenes(PROJECT_ID)).map((scene) => scene.id)
    );
    expect(heads.size).toBe(0);
  });

  it("refuses stale content-hash mismatches", async () => {
    const { captureServices, promotionServices } = await setup();
    const capture = await acknowledgedCapture(captureServices);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, {
          expectedCaptureContentHash: captureContentHash("f".repeat(64))
        })
      )
    ).rejects.toBeInstanceOf(CaptureContentHashMismatchError);
  });

  it("refuses empty, archived, integrated, and non-owner promotions", async () => {
    const { captureServices, promotionServices } = await setup();
    const scope = { accountId: OWNER, projectId: PROJECT_ID };

    const untouched = await captureServices.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput({
          ...untouched,
          contentHash: untouched.contentHash,
          captureId: untouched.captureId
        })
      )
    ).rejects.toBeInstanceOf(CapturePromotionNotEligibleError);

    const archived = await acknowledgedCapture(captureServices);
    await captureServices.setCaptureArchived({
      ...scope,
      captureId: archived.captureId,
      archived: true
    });
    await expect(
      promotionServices.promoteCaptureToScene(basePromotionInput(archived))
    ).rejects.toBeInstanceOf(CaptureArchivedMutationError);

    const integrated = await acknowledgedCapture(captureServices);
    await promotionServices.promoteCaptureToScene(
      basePromotionInput(integrated, { title: "First promotion" })
    );
    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(integrated, { title: "Second promotion" })
      )
    ).rejects.toBeInstanceOf(CaptureIntegratedMutationError);

    const owned = await acknowledgedCapture(captureServices);
    await expect(
      promotionServices.promoteCaptureToScene({
        ...basePromotionInput(owned),
        accountId: OTHER
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);

    await expect(
      promotionServices.promoteCaptureToScene({
        ...basePromotionInput(owned),
        captureId: captureId("capture-missing")
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
  });

  it("surfaces invalid manuscript placement through project command errors", async () => {
    const { captureServices, promotionServices } = await setup();
    const capture = await acknowledgedCapture(captureServices);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, {
          manuscriptPlacement: {
            kind: "chapter",
            bookId: SIGNAL_BOOK_ID,
            chapterId: chapterId("chapter-missing")
          }
        })
      )
    ).rejects.toBeInstanceOf(ProjectCommandError);
  });

  it("rolls back project, scene, capture, and canvas stores on injected failure", async () => {
    const { captureServices, promotionServices, projects, sceneDocuments, canvases, db } =
      await setup((unitOfWork) => ({
        commitCaptureScenePromotion(input) {
          return unitOfWork.commitCaptureScenePromotion({
            ...input,
            ...(input.canvasMutation === undefined
              ? {}
              : {
                  canvasMutation: {
                    ...input.canvasMutation,
                    board: createCanvasBoard({
                      ...input.canvasMutation.board,
                      updatedAt: "2026-07-24T18:00:01.000Z"
                    })
                  }
                })
          });
        }
      }));
    const capture = await acknowledgedCapture(captureServices);
    const sceneCount = (await projects.listScenes(PROJECT_ID)).length;
    await initializeProjectCanvas(canvases);

    await expect(
      promotionServices.promoteCaptureToScene(
        basePromotionInput(capture, {
          expectedCanvasVersion: 1,
          canvas: { x: 10, y: 10, width: 120, height: 90, z: 1 }
        })
      )
    ).rejects.toThrow();

    expect(await projects.listScenes(PROJECT_ID)).toHaveLength(sceneCount);
    expect(await projects.getProject(PROJECT_ID)).toMatchObject({ version: 1 });
    expect(
      await captureServices.getCapture({
        accountId: OWNER,
        projectId: PROJECT_ID,
        captureId: capture.captureId
      })
    ).toMatchObject({ status: "draft", workingVersion: 2 });
    expect(await canvases.getBoard(PROJECT_ID)).toMatchObject({ version: 1 });
    const heads = await sceneDocuments.getHeads(
      (await projects.listScenes(PROJECT_ID)).map((scene) => scene.id)
    );
    expect(heads.size).toBe(0);
    expect(await db.select().from(scenes)).toHaveLength(sceneCount);
    expect(await db.select().from(captureRevisions)).toHaveLength(1);
    expect(await db.select().from(canvasObjects)).toHaveLength(0);
    expect(await db.select().from(canvasRevisions)).toHaveLength(1);
  });

  it("allows only one concurrent promotion to win", async () => {
    const { captureServices, promotionServices } = await setup();
    const capture = await acknowledgedCapture(captureServices);
    const input = basePromotionInput(capture, { title: "Concurrent winner" });

    const outcomes = await Promise.allSettled([
      promotionServices.promoteCaptureToScene(input),
      promotionServices.promoteCaptureToScene({
        ...input,
        title: "Concurrent loser"
      })
    ]);

    const fulfilled = outcomes.filter(
      (
        outcome
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof promotionServices.promoteCaptureToScene>>
      > => outcome.status === "fulfilled"
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(CaptureIntegratedMutationError);

    const head = await captureServices.getCapture({
      accountId: OWNER,
      projectId: PROJECT_ID,
      captureId: capture.captureId
    });
    expect(head.status).toBe("integrated");
    expect(head.integratedSceneId).toBe(fulfilled[0]!.value.scene.id);
  });
});
