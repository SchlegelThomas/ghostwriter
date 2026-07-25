import {
  applyCanvasCommand,
  deriveCanvasReadingOrderSpine,
  CanvasNotFoundError,
  CanvasVersionConflictError,
  type CanvasBoard,
  type CanvasReadingOrderSpine
} from "./canvas.js";
import type { CanvasRepository } from "./canvas-repository.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import type { CaptureScenePromotionUnitOfWork } from "./capture-promotion-repository.js";
import {
  captureContentHash,
  CaptureArchivedMutationError,
  CaptureContentHashMismatchError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CapturePromotionNotEligibleError,
  CaptureVersionConflictError,
  createCaptureRevision,
  isEligibleCaptureForScenePromotion,
  ProjectArchivedMutationError,
  type CaptureContentHash,
  type CaptureDocumentHead
} from "./capture-documents.js";
import {
  captureRevisionId,
  revisionId,
  sceneId,
  type BookId,
  type CanvasObjectId,
  type CanvasRevisionId,
  type ChapterId,
  type ProjectId,
  type ProjectRecords,
  type Scene,
  type SceneId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import {
  applyProjectCommandToRecords,
  ProjectCommandError,
  type ProjectCommand
} from "./project-commands.js";
import { projectNavigatorFromRecords, type ProjectNavigator } from "./project-navigator.js";
import {
  ProjectVersionConflictError,
  type Clock,
  type DomainIdKind,
  type IdGenerator,
  type ProjectRepository
} from "./project-repository.js";
import { loadProjectRecords } from "./project-services.js";
import type { InitializeSceneDocumentInput } from "./scene-document-repository.js";
import {
  createSceneDocumentHead,
  createSceneRevision,
  sceneContentHash,
  type SceneDocumentHead
} from "./scene-documents.js";

export type PromoteCaptureManuscriptPlacement =
  | Readonly<{
      kind: "chapter";
      bookId: BookId;
      chapterId: ChapterId;
      position?: number;
    }>
  | Readonly<{
      kind: "unassigned";
      bookId: BookId;
      position?: number;
    }>;

export type PromoteCaptureCanvasPlacement = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  parentRegionId?: CanvasObjectId;
  storyOrderHint?: number;
  label?: string;
  sourceKey?: string;
  provenance?: string;
}>;

export type PromoteCaptureToSceneInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureDocumentHead["captureId"];
  expectedCaptureWorkingVersion: number;
  expectedCaptureContentHash: CaptureContentHash;
  expectedProjectVersion: number;
  expectedCanvasVersion?: number;
  title: string;
  manuscriptPlacement: PromoteCaptureManuscriptPlacement;
  canvas?: PromoteCaptureCanvasPlacement;
}>;

export type PromoteCaptureToSceneResult = Readonly<{
  scene: Scene;
  sceneDocumentHead: SceneDocumentHead;
  captureHead: CaptureDocumentHead;
  navigator: ProjectNavigator;
  canvas?: Readonly<{
    board: CanvasBoard;
    spine: CanvasReadingOrderSpine;
  }>;
}>;

export type CapturePromotionServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  canvases?: CanvasRepository;
  promotion: CaptureScenePromotionUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
}>;

async function requireOwnedProjectMutation(
  dependencies: CapturePromotionServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<ProjectRecords> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new CaptureNotFoundError();
    }
    throw error;
  }
  const project = await dependencies.projects.getProject(projectId);
  if (project === undefined) throw new CaptureNotFoundError();
  if (project.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
  const records = await loadProjectRecords(dependencies.projects, projectId);
  if (records === undefined) throw new CaptureNotFoundError();
  return records;
}

async function requireOwnedCapture(
  dependencies: CapturePromotionServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  captureId: CaptureDocumentHead["captureId"]
): Promise<CaptureDocumentHead> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new CaptureNotFoundError();
    }
    throw error;
  }
  const head = await dependencies.captureDocuments.get(captureId);
  if (head === undefined || head.projectId !== projectId) {
    throw new CaptureNotFoundError();
  }
  return head;
}

function sceneIdGenerator(
  ids: IdGenerator,
  generatedSceneId: SceneId
): IdGenerator {
  return Object.freeze({
    create(kind: DomainIdKind): string {
      return kind === "scene" ? generatedSceneId : ids.create(kind);
    }
  });
}

function sceneCreateCommand(
  title: string,
  manuscriptPlacement: PromoteCaptureManuscriptPlacement
): ProjectCommand {
  return {
    type: "scene.create",
    bookId: manuscriptPlacement.bookId,
    title,
    ...(manuscriptPlacement.kind === "chapter"
      ? { chapterId: manuscriptPlacement.chapterId }
      : {}),
    ...(manuscriptPlacement.position === undefined
      ? {}
      : { position: manuscriptPlacement.position })
  };
}

async function requireExistingCanvasBoard(
  dependencies: CapturePromotionServiceDependencies,
  projectId: ProjectId
): Promise<CanvasBoard> {
  if (dependencies.canvases === undefined) {
    throw new CanvasNotFoundError();
  }
  const board = await dependencies.canvases.getBoard(projectId);
  if (board === undefined) {
    throw new CanvasNotFoundError();
  }
  return board;
}

async function latestRevisionId(
  canvases: CanvasRepository,
  projectId: ProjectId
): Promise<CanvasRevisionId | undefined> {
  return (await canvases.listRevisions(projectId))[0]?.id;
}

export async function createInitialSceneDocumentStateFromCapture(input: {
  projectId: ProjectId;
  sceneId: SceneId;
  captureHead: CaptureDocumentHead;
  actorAccountId: AccountId;
  ids: IdGenerator;
  now: string;
}): Promise<InitializeSceneDocumentInput> {
  const newRevisionId = revisionId(input.ids.create("revision"));
  const document = input.captureHead.document;
  const contentHash = sceneContentHash(String(input.captureHead.contentHash));
  const genesisRevision = createSceneRevision({
    id: newRevisionId,
    sceneId: input.sceneId,
    projectId: input.projectId,
    document,
    contentHash,
    actorAccountId: input.actorAccountId,
    origin: "human",
    reason: "capture-promotion",
    createdAt: input.now
  });
  const head = createSceneDocumentHead({
    sceneId: input.sceneId,
    projectId: input.projectId,
    workingVersion: 1,
    document,
    contentHash,
    checkpointRevisionId: newRevisionId,
    updatedByAccountId: input.actorAccountId,
    createdAt: input.now,
    updatedAt: input.now
  });
  return Object.freeze({ head, genesisRevision });
}

export async function promoteCaptureToScene(
  dependencies: CapturePromotionServiceDependencies,
  input: PromoteCaptureToSceneInput
): Promise<PromoteCaptureToSceneResult> {
  const records = await requireOwnedProjectMutation(
    dependencies,
    input.accountId,
    input.projectId
  );

  const captureHead = await requireOwnedCapture(
    dependencies,
    input.accountId,
    input.projectId,
    input.captureId
  );
  if (captureHead.status === "integrated") {
    throw new CaptureIntegratedMutationError();
  }
  if (captureHead.status === "archived") {
    throw new CaptureArchivedMutationError();
  }
  if (captureHead.workingVersion !== input.expectedCaptureWorkingVersion) {
    throw new CaptureVersionConflictError();
  }
  if (captureHead.contentHash !== captureContentHash(input.expectedCaptureContentHash)) {
    throw new CaptureContentHashMismatchError();
  }

  const genesisRevision = await dependencies.captureDocuments.getRevision(
    captureHead.genesisRevisionId
  );
  if (genesisRevision === undefined) {
    throw new CaptureNotFoundError();
  }
  if (!isEligibleCaptureForScenePromotion(captureHead, genesisRevision)) {
    throw new CapturePromotionNotEligibleError();
  }

  if (records.project.version !== input.expectedProjectVersion) {
    throw new ProjectVersionConflictError(
      input.projectId,
      input.expectedProjectVersion
    );
  }

  const hasCanvas = input.canvas !== undefined;
  if (hasCanvas !== (input.expectedCanvasVersion !== undefined)) {
    throw new CapturePromotionNotEligibleError();
  }
  if (hasCanvas && dependencies.canvases === undefined) {
    throw new CanvasNotFoundError();
  }

  let board: CanvasBoard | undefined;
  if (hasCanvas) {
    board = await requireExistingCanvasBoard(dependencies, input.projectId);
    if (board.version !== input.expectedCanvasVersion) {
      throw new CanvasVersionConflictError(
        input.projectId,
        input.expectedCanvasVersion!
      );
    }
  }

  const now = dependencies.clock.now();
  const generatedSceneId = sceneId(dependencies.ids.create("scene"));
  let updatedRecords: ProjectRecords;
  try {
    updatedRecords = applyProjectCommandToRecords(
      records,
      sceneCreateCommand(input.title, input.manuscriptPlacement),
      sceneIdGenerator(dependencies.ids, generatedSceneId),
      now
    );
  } catch (error) {
    if (error instanceof ProjectCommandError) {
      throw error;
    }
    throw error;
  }

  const scene = updatedRecords.scenes.find(
    (candidate) => candidate.id === generatedSceneId
  );
  if (scene === undefined) {
    throw new Error("Canonical scene creation returned no scene.");
  }

  const sceneDocument = await createInitialSceneDocumentStateFromCapture({
    projectId: input.projectId,
    sceneId: generatedSceneId,
    captureHead,
    actorAccountId: input.accountId,
    ids: dependencies.ids,
    now
  });

  const integrationRevision = createCaptureRevision({
    id: captureRevisionId(dependencies.ids.create("captureRevision")),
    captureId: captureHead.captureId,
    projectId: input.projectId,
    parentRevisionId: captureHead.genesisRevisionId,
    document: captureHead.document,
    contentHash: captureHead.contentHash,
    actorAccountId: input.accountId,
    origin: "human",
    reason: "integration",
    createdAt: now
  });

  let canvasMutation;
  if (hasCanvas && input.canvas !== undefined && board !== undefined) {
    const parentRevisionId = await latestRevisionId(
      dependencies.canvases!,
      input.projectId
    );
    canvasMutation = await applyCanvasCommand({
      board,
      projectRecords: updatedRecords,
      expectedCanvasVersion: input.expectedCanvasVersion!,
      command: {
        type: "canvas.object.place",
        object: {
          kind: "scene-card",
          x: input.canvas.x,
          y: input.canvas.y,
          width: input.canvas.width,
          height: input.canvas.height,
          z: input.canvas.z,
          authority: "confirmed",
          label: input.canvas.label ?? scene.title,
          sceneId: generatedSceneId,
          ...(input.canvas.parentRegionId === undefined
            ? {}
            : { parentRegionId: input.canvas.parentRegionId }),
          ...(input.canvas.storyOrderHint === undefined
            ? {}
            : { storyOrderHint: input.canvas.storyOrderHint }),
          ...(input.canvas.sourceKey === undefined
            ? {}
            : { sourceKey: input.canvas.sourceKey }),
          ...(input.canvas.provenance === undefined
            ? {}
            : { provenance: input.canvas.provenance })
        }
      },
      actorAccountId: input.accountId,
      ids: dependencies.ids,
      now,
      ...(parentRevisionId === undefined ? {} : { parentRevisionId })
    });
  }

  await dependencies.promotion.commitCaptureScenePromotion({
    accountId: input.accountId,
    projectRecords: updatedRecords,
    expectedProjectVersion: input.expectedProjectVersion,
    sceneDocument,
    captureIntegration: {
      projectId: input.projectId,
      captureId: captureHead.captureId,
      expectedWorkingVersion: input.expectedCaptureWorkingVersion,
      expectedContentHash: captureHead.contentHash,
      integrationRevision,
      integratedSceneId: generatedSceneId,
      actorAccountId: input.accountId,
      now
    },
    ...(canvasMutation === undefined
      ? {}
      : {
          canvasMutation,
          expectedCanvasVersion: input.expectedCanvasVersion
        })
  });

  const integratedHead = await dependencies.captureDocuments.get(captureHead.captureId);
  if (integratedHead === undefined) {
    throw new CaptureNotFoundError();
  }

  return Object.freeze({
    scene,
    sceneDocumentHead: sceneDocument.head,
    captureHead: integratedHead,
    navigator: projectNavigatorFromRecords(updatedRecords),
    ...(canvasMutation === undefined
      ? {}
      : {
          canvas: Object.freeze({
            board: canvasMutation.board,
            spine: deriveCanvasReadingOrderSpine(updatedRecords, canvasMutation.board)
          })
        })
  });
}

export type CapturePromotionServices = Readonly<{
  promoteCaptureToScene(
    input: PromoteCaptureToSceneInput
  ): Promise<PromoteCaptureToSceneResult>;
}>;

export function createCapturePromotionServices(
  dependencies: CapturePromotionServiceDependencies
): CapturePromotionServices {
  return Object.freeze({
    promoteCaptureToScene(input) {
      return promoteCaptureToScene(dependencies, input);
    }
  });
}
