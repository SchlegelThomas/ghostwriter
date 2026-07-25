import { hashSceneDocument } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { createCanvasBoard, CanvasNotFoundError, CanvasVersionConflictError, createInitialCanvas } from "./canvas.js";
import { createCaptureServices } from "./capture-services.js";
import {
  createCapturePromotionServices,
  type PromoteCaptureToSceneInput
} from "./capture-promotion-services.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import {
  CaptureArchivedMutationError,
  CaptureContentHashMismatchError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CapturePromotionNotEligibleError,
  CaptureVersionConflictError,
  captureContentHash
} from "./capture-documents.js";
import {
  bookId,
  chapterId,
  captureId
} from "./domain.js";
import { ProjectCommandError } from "./project-commands.js";
import { ProjectVersionConflictError } from "./project-repository.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import type { CaptureScenePromotionUnitOfWork } from "./capture-promotion-repository.js";
import { createMemoryCaptureScenePromotionUnitOfWork } from "./memory-capture-scene-promotion-uow.js";
import { createMemoryCanvasRepository } from "./memory-canvas-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

const OWNER = accountId("account-promotion-owner");
const OTHER = accountId("account-promotion-other");
const PROJECT_ID = BELLWETHER_FIXTURE_PROJECT_ID;
const SIGNAL_BOOK_ID = bookId("book-signal-at-bellwether");
const LOW_TIDE_CHAPTER_ID = chapterId("chapter-low-tide");
const NOW = "2026-07-24T18:00:00.000Z";

function documentWith(text: string, blockId = "block-capture-promo-1") {
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

function setup(
  unitOfWorkDecorator?: (
    unitOfWork: CaptureScenePromotionUnitOfWork
  ) => CaptureScenePromotionUnitOfWork
) {
  let now = NOW;
  let sequence = 0;
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: PROJECT_ID,
        accountId: OWNER,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  const canvases = createMemoryCanvasRepository();
  const sceneDocuments = createMemorySceneDocumentRepository();
  const ids = {
    create(kind: string) {
      sequence += 1;
      return `${kind}-promo-${sequence}`;
    }
  };
  const baseUnitOfWork = createMemoryCaptureScenePromotionUnitOfWork({
    projects,
    sceneDocuments,
    captureDocuments,
    canvases
  });
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
    captureServices,
    promotionServices,
    projects,
    captureDocuments,
    sceneDocuments,
    canvases,
    setNow(value: string) {
      now = value;
    }
  };
}

async function acknowledgedCapture(
  captureServices: ReturnType<typeof setup>["captureServices"]
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
    document: documentWith("Promoted lighthouse note.", "block-promo-stable")
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
  canvases: ReturnType<typeof setup>["canvases"]
) {
  return canvases.initialize(
    await createInitialCanvas({
      projectId: PROJECT_ID,
      actorAccountId: OWNER,
      now: NOW
    })
  );
}

describe("capture promotion services with memory storage", () => {
  it("promotes to unassigned scene without touching Canvas", async () => {
    const { captureServices, promotionServices, projects, canvases, sceneDocuments } =
      setup();
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
    const navigatorBook = result.navigator.books.find(
      (book) => book.id === SIGNAL_BOOK_ID
    );
    expect(navigatorBook?.unassignedScenes.some((scene) => scene.id === result.scene.id)).toBe(
      true
    );
  });

  it("promotes into a chapter with optional Canvas card on the same SceneId", async () => {
    const { captureServices, promotionServices, canvases } = setup();
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
      setup();
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
      attrs: { id: "block-promo-stable" }
    });
    expect(await hashSceneDocument(sceneHead!.document)).toBe(
      await hashSceneDocument(capture.document)
    );

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
    const { captureServices, promotionServices, projects, canvases } = setup();
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
      setup();
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
    const { captureServices, promotionServices } = setup();
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
    const { captureServices, promotionServices } = setup();
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
    const { captureServices, promotionServices } = setup();
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
    const { captureServices, promotionServices, projects, sceneDocuments, canvases } =
      setup((unitOfWork) => ({
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
    expect(await captureServices.getCapture({
      accountId: OWNER,
      projectId: PROJECT_ID,
      captureId: capture.captureId
    })).toMatchObject({ status: "draft", workingVersion: 2 });
    expect(await canvases.getBoard(PROJECT_ID)).toMatchObject({ version: 1 });
    const heads = await sceneDocuments.getHeads(
      (await projects.listScenes(PROJECT_ID)).map((scene) => scene.id)
    );
    expect(heads.size).toBe(0);
  });

  it("allows only one concurrent promotion to win", async () => {
    const { captureServices, promotionServices } = setup();
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
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof promotionServices.promoteCaptureToScene>>> =>
        outcome.status === "fulfilled"
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

  it("maps capture integration refusal inside the transaction to stable errors", async () => {
    let sequence = 0;
    const baseCaptureDocuments = createMemoryCaptureDocumentRepository();
    const transactionState = (baseCaptureDocuments as MemoryTransactionalRepository)[
      MEMORY_TRANSACTION_STATE
    ]!;
    const captureDocuments: CaptureDocumentRepository &
      MemoryTransactionalRepository = {
      get: (captureId) => baseCaptureDocuments.get(captureId),
      getRevision: (revisionId) => baseCaptureDocuments.getRevision(revisionId),
      list: (projectId, options) => baseCaptureDocuments.list(projectId, options),
      initialize: (input) => baseCaptureDocuments.initialize(input),
      saveWorkingDocument: (input) =>
        baseCaptureDocuments.saveWorkingDocument(input),
      setArchived: (input) => baseCaptureDocuments.setArchived(input),
      integrate: async () => ({ ok: false, reason: "capture-integrated" }),
      [MEMORY_TRANSACTION_STATE]: transactionState
    };
    const projects = createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: PROJECT_ID,
          accountId: OWNER,
          role: "owner",
          createdAt: NOW
        })
      ]
    );
    const sceneDocuments = createMemorySceneDocumentRepository();
    const ids = {
      create(kind: string) {
        sequence += 1;
        return `${kind}-integrate-${sequence}`;
      }
    };
    const captureServices = createCaptureServices({
      projects,
      captureDocuments,
      ids,
      clock: { now: () => NOW }
    });
    const promotionServices = createCapturePromotionServices({
      projects,
      captureDocuments,
      promotion: createMemoryCaptureScenePromotionUnitOfWork({
        projects,
        sceneDocuments,
        captureDocuments
      }),
      ids,
      clock: { now: () => NOW }
    });
    const capture = await acknowledgedCapture(captureServices);
    const sceneCount = (await projects.listScenes(PROJECT_ID)).length;

    await expect(
      promotionServices.promoteCaptureToScene(basePromotionInput(capture))
    ).rejects.toBeInstanceOf(CaptureIntegratedMutationError);

    expect(await projects.listScenes(PROJECT_ID)).toHaveLength(sceneCount);
    expect(
      await captureServices.getCapture({
        accountId: OWNER,
        projectId: PROJECT_ID,
        captureId: capture.captureId
      })
    ).toMatchObject({ status: "draft", workingVersion: 2 });
  });

  it("promotes without Canvas when canvas repository is omitted from dependencies", async () => {
    let sequence = 0;
    const captureDocuments = createMemoryCaptureDocumentRepository();
    const projects = createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: PROJECT_ID,
          accountId: OWNER,
          role: "owner",
          createdAt: NOW
        })
      ]
    );
    const sceneDocuments = createMemorySceneDocumentRepository();
    const captureServices = createCaptureServices({
      projects,
      captureDocuments,
      ids: {
        create(kind: string) {
          sequence += 1;
          return `${kind}-no-canvas-${sequence}`;
        }
      },
      clock: { now: () => NOW }
    });
    const promotionServices = createCapturePromotionServices({
      projects,
      captureDocuments,
      promotion: createMemoryCaptureScenePromotionUnitOfWork({
        projects,
        sceneDocuments,
        captureDocuments
      }),
      ids: {
        create(kind: string) {
          sequence += 1;
          return `${kind}-no-canvas-${sequence}`;
        }
      },
      clock: { now: () => NOW }
    });
    const capture = await acknowledgedCapture(captureServices);
    const result = await promotionServices.promoteCaptureToScene(
      basePromotionInput(capture)
    );
    expect(result.canvas).toBeUndefined();
  });
});
