import {
  applyCanvasCommand,
  createCanvasViewportPreference,
  createInitialCanvas,
  deriveCanvasReadingOrderSpine,
  restoreCanvasSnapshot,
  CanvasNotFoundError,
  CanvasRevisionNotFoundError,
  CanvasVersionConflictError,
  type CanvasBoard,
  type CanvasCommand,
  type CanvasReadingOrderSpine,
  type CanvasRevisionMetadata,
  type CanvasViewportPreference
} from "./canvas.js";
import type {
  CanvasRepository,
  CanvasSceneCreationUnitOfWork
} from "./canvas-repository.js";
import {
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
import {
  createInitialSceneDocumentState,
  type SceneWritingServiceDependencies
} from "./scene-writing-services.js";
import type { SceneDocumentHead } from "./scene-documents.js";

export type CanvasWorkspace = Readonly<{
  board: CanvasBoard;
  spine: CanvasReadingOrderSpine;
}>;

export type CreateSceneFromCanvasPlacement =
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

export type CreateSceneFromCanvasInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  expectedProjectVersion: number;
  expectedCanvasVersion: number;
  title: string;
  manuscriptPlacement: CreateSceneFromCanvasPlacement;
  canvas: Readonly<{
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
}>;

export type CreateSceneFromCanvasResult = Readonly<{
  scene: Scene;
  sceneDocumentHead: SceneDocumentHead;
  navigator: ProjectNavigator;
  canvas: CanvasWorkspace;
}>;

export type CanvasServices = Readonly<{
  getCanvasWorkspace(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<CanvasWorkspace>;
  executeCanvasCommand(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedCanvasVersion: number;
    command: CanvasCommand;
  }>): Promise<CanvasWorkspace>;
  listCanvasHistory(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<readonly CanvasRevisionMetadata[]>;
  restoreCanvasRevision(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedCanvasVersion: number;
    revisionId: CanvasRevisionId;
  }>): Promise<CanvasWorkspace>;
  undoCanvas(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedCanvasVersion: number;
  }>): Promise<CanvasWorkspace>;
  getCanvasViewportPreference(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<CanvasViewportPreference | undefined>;
  saveCanvasViewportPreference(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    x: number;
    y: number;
    zoom: number;
    selectedObjectId?: CanvasObjectId;
  }>): Promise<CanvasViewportPreference>;
  createSceneFromCanvas(
    input: CreateSceneFromCanvasInput
  ): Promise<CreateSceneFromCanvasResult>;
}>;

export type CanvasServiceDependencies = Readonly<{
  projects: ProjectRepository;
  canvases: CanvasRepository;
  sceneDocuments: SceneWritingServiceDependencies["sceneDocuments"];
  sceneCreation: CanvasSceneCreationUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
}>;

async function requireOwnedRecords(
  dependencies: CanvasServiceDependencies,
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
      throw new CanvasNotFoundError();
    }
    throw error;
  }
  const records = await loadProjectRecords(dependencies.projects, projectId);
  if (records === undefined) throw new CanvasNotFoundError();
  return records;
}

async function getOrInitializeBoard(
  dependencies: CanvasServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<CanvasBoard> {
  const existing = await dependencies.canvases.getBoard(projectId);
  if (existing !== undefined) return existing;
  const initial = await createInitialCanvas({
    projectId,
    actorAccountId: accountId,
    now: dependencies.clock.now()
  });
  return dependencies.canvases.initialize(initial);
}

function workspace(
  records: ProjectRecords,
  board: CanvasBoard
): CanvasWorkspace {
  return Object.freeze({
    board,
    spine: deriveCanvasReadingOrderSpine(records, board)
  });
}

async function latestRevisionId(
  canvases: CanvasRepository,
  projectId: ProjectId
): Promise<CanvasRevisionId | undefined> {
  return (await canvases.listRevisions(projectId))[0]?.id;
}

async function restoreRevision(
  dependencies: CanvasServiceDependencies,
  input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedCanvasVersion: number;
    revisionId: CanvasRevisionId;
    reason: "restore" | "undo";
  }>
): Promise<CanvasWorkspace> {
  const records = await requireOwnedRecords(
    dependencies,
    input.accountId,
    input.projectId
  );
  const board = await getOrInitializeBoard(
    dependencies,
    input.accountId,
    input.projectId
  );
  const target = await dependencies.canvases.getRevision(
    input.projectId,
    input.revisionId
  );
  if (target === undefined) throw new CanvasRevisionNotFoundError();
  const parentRevisionId = await latestRevisionId(
    dependencies.canvases,
    input.projectId
  );
  const mutation = await restoreCanvasSnapshot({
    currentBoard: board,
    targetRevision: target,
    projectRecords: records,
    expectedCanvasVersion: input.expectedCanvasVersion,
    actorAccountId: input.accountId,
    now: dependencies.clock.now(),
    reason: input.reason,
    ...(parentRevisionId === undefined ? {} : { parentRevisionId })
  });
  const saved = await dependencies.canvases.replace({
    mutation,
    expectedCanvasVersion: input.expectedCanvasVersion
  });
  return workspace(records, saved);
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

function sceneCreateCommand(input: CreateSceneFromCanvasInput): ProjectCommand {
  return {
    type: "scene.create",
    bookId: input.manuscriptPlacement.bookId,
    title: input.title,
    ...(input.manuscriptPlacement.kind === "chapter"
      ? { chapterId: input.manuscriptPlacement.chapterId }
      : {}),
    ...(input.manuscriptPlacement.position === undefined
      ? {}
      : { position: input.manuscriptPlacement.position })
  };
}

export function createCanvasServices(
  dependencies: CanvasServiceDependencies
): CanvasServices {
  return Object.freeze({
    async getCanvasWorkspace(input): Promise<CanvasWorkspace> {
      const records = await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      const board = await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      return workspace(records, board);
    },
    async executeCanvasCommand(input): Promise<CanvasWorkspace> {
      const records = await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      const board = await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      const parentRevisionId = await latestRevisionId(
        dependencies.canvases,
        input.projectId
      );
      const mutation = await applyCanvasCommand({
        board,
        projectRecords: records,
        expectedCanvasVersion: input.expectedCanvasVersion,
        command: input.command,
        actorAccountId: input.accountId,
        ids: dependencies.ids,
        now: dependencies.clock.now(),
        ...(parentRevisionId === undefined ? {} : { parentRevisionId })
      });
      const saved = await dependencies.canvases.replace({
        mutation,
        expectedCanvasVersion: input.expectedCanvasVersion
      });
      return workspace(records, saved);
    },
    async listCanvasHistory(input): Promise<readonly CanvasRevisionMetadata[]> {
      await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      return dependencies.canvases.listRevisions(input.projectId);
    },
    restoreCanvasRevision(input): Promise<CanvasWorkspace> {
      return restoreRevision(dependencies, { ...input, reason: "restore" });
    },
    async undoCanvas(input): Promise<CanvasWorkspace> {
      await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      const board = await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      if (board.version !== input.expectedCanvasVersion) {
        throw new CanvasVersionConflictError(
          input.projectId,
          input.expectedCanvasVersion
        );
      }
      const target = (await dependencies.canvases.listRevisions(input.projectId))
        .find((revision) => revision.boardVersion < board.version);
      if (target === undefined) throw new CanvasRevisionNotFoundError();
      return restoreRevision(dependencies, {
        ...input,
        revisionId: target.id,
        reason: "undo"
      });
    },
    async getCanvasViewportPreference(input) {
      await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      return dependencies.canvases.getViewportPreference(
        input.projectId,
        input.accountId
      );
    },
    async saveCanvasViewportPreference(input) {
      await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      const board = await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      if (
        input.selectedObjectId !== undefined &&
        !board.objects.some((object) => object.id === input.selectedObjectId)
      ) {
        throw new CanvasNotFoundError();
      }
      return dependencies.canvases.saveViewportPreference(
        createCanvasViewportPreference({
          projectId: input.projectId,
          accountId: input.accountId,
          x: input.x,
          y: input.y,
          zoom: input.zoom,
          ...(input.selectedObjectId === undefined
            ? {}
            : { selectedObjectId: input.selectedObjectId }),
          updatedAt: dependencies.clock.now()
        })
      );
    },
    async createSceneFromCanvas(
      input: CreateSceneFromCanvasInput
    ): Promise<CreateSceneFromCanvasResult> {
      const records = await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      if (records.project.version !== input.expectedProjectVersion) {
        throw new ProjectVersionConflictError(
          input.projectId,
          input.expectedProjectVersion
        );
      }
      const board = await getOrInitializeBoard(
        dependencies,
        input.accountId,
        input.projectId
      );
      if (board.version !== input.expectedCanvasVersion) {
        throw new CanvasVersionConflictError(
          input.projectId,
          input.expectedCanvasVersion
        );
      }
      const now = dependencies.clock.now();
      const generatedSceneId = sceneId(dependencies.ids.create("scene"));
      const updatedRecords = applyProjectCommandToRecords(
        records,
        sceneCreateCommand(input),
        sceneIdGenerator(dependencies.ids, generatedSceneId),
        now
      );
      const scene = updatedRecords.scenes.find(
        (candidate) => candidate.id === generatedSceneId
      );
      if (scene === undefined) {
        throw new Error("Canonical scene creation returned no scene.");
      }
      const sceneDocument = await createInitialSceneDocumentState({
        projectId: input.projectId,
        sceneId: generatedSceneId,
        actorAccountId: input.accountId,
        ids: dependencies.ids,
        now
      });
      const parentRevisionId = await latestRevisionId(
        dependencies.canvases,
        input.projectId
      );
      const canvasMutation = await applyCanvasCommand({
        board,
        projectRecords: updatedRecords,
        expectedCanvasVersion: input.expectedCanvasVersion,
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

      await dependencies.sceneCreation.commitSceneFromCanvas({
        accountId: input.accountId,
        projectRecords: updatedRecords,
        expectedProjectVersion: input.expectedProjectVersion,
        sceneDocument,
        canvasMutation,
        expectedCanvasVersion: input.expectedCanvasVersion
      });
      return Object.freeze({
        scene,
        sceneDocumentHead: sceneDocument.head,
        navigator: projectNavigatorFromRecords(updatedRecords),
        canvas: workspace(updatedRecords, canvasMutation.board)
      });
    }
  });
}
