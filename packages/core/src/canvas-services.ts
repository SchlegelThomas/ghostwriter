import {
  CANVAS_PERSONAL_VIEW_MAX_SCOPES,
  applyCanvasCommand,
  canvasPersonalScopeKey,
  createCanvasPersonalScopeView,
  createCanvasPersonalViewPreference,
  createCanvasViewportPreference,
  createInitialCanvas,
  deriveCanvasReadingOrderSpine,
  requireCanvasScope,
  restoreCanvasSnapshot,
  CanvasNotFoundError,
  CanvasRevisionNotFoundError,
  CanvasVersionConflictError,
  type CanvasBoard,
  type CanvasPersonalScopeView,
  type CanvasPersonalViewPreference,
  type CanvasScopeRef,
  type CanvasCommand,
  type CanvasReadingOrderSpine,
  type CanvasRevision,
  type CanvasRevisionMetadata,
  type CanvasViewportPreference
} from "./canvas.js";
import type {
  CanvasRepository,
  CanvasSceneCreationUnitOfWork
} from "./canvas-repository.js";
import {
  DomainValidationError,
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
    scope?: CanvasScopeRef;
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

export const CANVAS_HISTORY_DEFAULT_LIMIT = 100;
export const CANVAS_HISTORY_MAX_LIMIT = 100;
const CANVAS_UNDO_MAX_POINTERS = 100;

export type CanvasHistoryPage = Readonly<{
  revisions: readonly CanvasRevisionMetadata[];
  nextBeforeVersion?: number;
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
    limit?: number;
    beforeVersion?: number;
  }>): Promise<CanvasHistoryPage>;
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
  getCanvasPersonalViewPreference(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<CanvasPersonalViewPreference | undefined>;
  saveCanvasPersonalViewPreference(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    expectedPreferenceVersion: number;
    scopeView: Omit<CanvasPersonalScopeView, "updatedAt">;
    lastScope: CanvasScopeRef;
  }>): Promise<CanvasPersonalViewPreference>;
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

function fallbackPersonalScope(
  scope: CanvasScopeRef,
  records: ProjectRecords
): CanvasScopeRef {
  try {
    requireCanvasScope(scope, records);
    return scope;
  } catch (error) {
    if (!(error instanceof DomainValidationError) || scope.scopeKind !== "scene") {
      return { scopeKind: "project" };
    }
  }
  const scene = records.scenes.find((candidate) => candidate.id === scope.scopeId);
  if (scene === undefined) return { scopeKind: "project" };
  const book = records.books.find(
    (candidate) => candidate.id === scene.bookId && candidate.archivedAt === undefined
  );
  if (book === undefined) return { scopeKind: "project" };
  for (const part of book.manuscript.parts) {
    const chapter = part.chapters.find((candidate) =>
      candidate.sceneIds.includes(scene.id)
    );
    if (chapter !== undefined) {
      return { scopeKind: "chapter", scopeId: chapter.id };
    }
  }
  return { scopeKind: "project" };
}

function sanitizePersonalViewReferences(
  preference: CanvasPersonalViewPreference,
  records: ProjectRecords,
  board: CanvasBoard
): CanvasPersonalViewPreference {
  const objectIds = new Set(board.objects.map((object) => object.id));
  const sceneIds = new Set(records.scenes.map((scene) => scene.id));
  return createCanvasPersonalViewPreference({
    ...preference,
    lastScope: fallbackPersonalScope(preference.lastScope, records),
    scopeViews: preference.scopeViews.map((view) => {
      const { selectedObjectId, inspectedSceneId, ...rest } = view;
      return createCanvasPersonalScopeView({
        ...rest,
        ...(selectedObjectId !== undefined && objectIds.has(selectedObjectId)
          ? { selectedObjectId }
          : {}),
        ...(inspectedSceneId !== undefined && sceneIds.has(inspectedSceneId)
          ? { inspectedSceneId }
          : {})
      });
    })
  });
}

export function boundedCanvasPersonalScopeViews(
  views: readonly CanvasPersonalScopeView[],
  lastScope: CanvasScopeRef
): readonly CanvasPersonalScopeView[] {
  if (views.length <= CANVAS_PERSONAL_VIEW_MAX_SCOPES) return views;
  const currentKey = canvasPersonalScopeKey(lastScope);
  const removable = views
    .filter((view) => {
      const key = canvasPersonalScopeKey(view.scope);
      return key !== "project" && key !== currentKey;
    })
    .sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        canvasPersonalScopeKey(left.scope).localeCompare(
          canvasPersonalScopeKey(right.scope)
        )
    );
  const removeKeys = new Set(
    removable
      .slice(0, views.length - CANVAS_PERSONAL_VIEW_MAX_SCOPES)
      .map((view) => canvasPersonalScopeKey(view.scope))
  );
  return views.filter(
    (view) => !removeKeys.has(canvasPersonalScopeKey(view.scope))
  );
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
  return (await canvases.listRevisions(projectId, { limit: 1 }))[0]?.id;
}

type RevisionPointer = Pick<
  CanvasRevision,
  | "id"
  | "projectId"
  | "boardVersion"
  | "reason"
  | "parentRevisionId"
  | "restoredFromRevisionId"
>;

type RevisionTraversal = {
  remaining: number;
  visited: Set<CanvasRevisionId>;
};

async function pointedRevision(
  canvases: CanvasRepository,
  projectId: ProjectId,
  revisionId: CanvasRevisionId,
  traversal: RevisionTraversal
): Promise<CanvasRevision> {
  if (traversal.remaining <= 0 || traversal.visited.has(revisionId)) {
    throw new CanvasRevisionNotFoundError();
  }
  traversal.remaining -= 1;
  traversal.visited.add(revisionId);
  const revision = await canvases.getRevision(projectId, revisionId);
  if (revision === undefined) throw new CanvasRevisionNotFoundError();
  return revision;
}

async function logicalCanvasRevision(
  canvases: CanvasRepository,
  projectId: ProjectId,
  startingRevision: RevisionPointer,
  traversal: RevisionTraversal
): Promise<Readonly<{ revision: RevisionPointer; boundary: boolean }>> {
  let revision = startingRevision;
  while (revision.reason === "undo") {
    if (revision.restoredFromRevisionId === undefined) {
      return Object.freeze({ revision, boundary: true });
    }
    revision = await pointedRevision(
      canvases,
      projectId,
      revision.restoredFromRevisionId,
      traversal
    );
  }
  return Object.freeze({ revision, boundary: false });
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
    async listCanvasHistory(input): Promise<CanvasHistoryPage> {
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
      const limit = input.limit ?? CANVAS_HISTORY_DEFAULT_LIMIT;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > CANVAS_HISTORY_MAX_LIMIT
      ) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          `Canvas history limit must be between 1 and ${CANVAS_HISTORY_MAX_LIMIT}.`
        );
      }
      if (
        input.beforeVersion !== undefined &&
        (!Number.isInteger(input.beforeVersion) || input.beforeVersion < 1)
      ) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Canvas history cursor must be a positive integer."
        );
      }
      const page = await dependencies.canvases.listRevisions(input.projectId, {
        limit: limit + 1,
        ...(input.beforeVersion === undefined
          ? {}
          : { beforeVersion: input.beforeVersion })
      });
      const revisions = Object.freeze(page.slice(0, limit));
      return Object.freeze({
        revisions,
        ...(page.length <= limit || revisions.length === 0
          ? {}
          : { nextBeforeVersion: revisions[revisions.length - 1]!.boardVersion })
      });
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
      const [head] = await dependencies.canvases.listRevisions(input.projectId, {
        limit: 1
      });
      if (head === undefined || head.boardVersion !== board.version) {
        throw new CanvasRevisionNotFoundError();
      }
      const traversal: RevisionTraversal = {
        remaining: CANVAS_UNDO_MAX_POINTERS,
        visited: new Set([head.id])
      };
      const logicalCurrent = await logicalCanvasRevision(
        dependencies.canvases,
        input.projectId,
        head,
        traversal
      );
      if (
        logicalCurrent.boundary ||
        logicalCurrent.revision.parentRevisionId === undefined
      ) {
        throw new CanvasRevisionNotFoundError();
      }
      const predecessor = await pointedRevision(
        dependencies.canvases,
        input.projectId,
        logicalCurrent.revision.parentRevisionId,
        traversal
      );
      const target = await logicalCanvasRevision(
        dependencies.canvases,
        input.projectId,
        predecessor,
        traversal
      );
      return restoreRevision(dependencies, {
        ...input,
        revisionId: target.revision.id,
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
      const board = await dependencies.canvases.getBoard(input.projectId);
      if (board === undefined) throw new CanvasNotFoundError();
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
    async getCanvasPersonalViewPreference(input) {
      const records = await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      const preference = await dependencies.canvases.getPersonalViewPreference(
        input.projectId,
        input.accountId
      );
      if (preference === undefined) return undefined;
      const board = await dependencies.canvases.getBoard(input.projectId);
      if (board === undefined) return undefined;
      return sanitizePersonalViewReferences(preference, records, board);
    },
    async saveCanvasPersonalViewPreference(input) {
      if (
        !Number.isSafeInteger(input.expectedPreferenceVersion) ||
        input.expectedPreferenceVersion < 0
      ) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Expected Canvas preference version must be a non-negative integer."
        );
      }
      const records = await requireOwnedRecords(
        dependencies,
        input.accountId,
        input.projectId
      );
      requireCanvasScope(input.scopeView.scope, records);
      requireCanvasScope(input.lastScope, records);
      const board = await dependencies.canvases.getBoard(input.projectId);
      if (board === undefined) throw new CanvasNotFoundError();
      if (
        input.scopeView.selectedObjectId !== undefined &&
        !board.objects.some(
          (object) => object.id === input.scopeView.selectedObjectId
        )
      ) {
        throw new CanvasNotFoundError();
      }
      if (
        input.scopeView.inspectedSceneId !== undefined &&
        !records.scenes.some(
          (scene) => scene.id === input.scopeView.inspectedSceneId
        )
      ) {
        throw new CanvasNotFoundError();
      }
      const now = dependencies.clock.now();
      const current = await dependencies.canvases.getPersonalViewPreference(
        input.projectId,
        input.accountId
      );
      const nextScopeView = createCanvasPersonalScopeView({
        ...input.scopeView,
        updatedAt: now
      });
      const byScope = new Map(
        (current?.scopeViews ?? []).map((view) => [
          canvasPersonalScopeKey(view.scope),
          view
        ])
      );
      if (!byScope.has("project")) {
        byScope.set(
          "project",
          createCanvasPersonalScopeView({
            scope: { scopeKind: "project" },
            viewport: { x: 0, y: 0, zoom: 1 },
            viewMode: "spatial",
            inspectorOpen: false,
            focusToken: "surface",
            workflowLens: "outline",
            updatedAt: now
          })
        );
      }
      byScope.set(canvasPersonalScopeKey(nextScopeView.scope), nextScopeView);
      const scopeViews = boundedCanvasPersonalScopeViews(
        [...byScope.values()],
        input.lastScope
      );
      return dependencies.canvases.savePersonalViewPreference({
        expectedPreferenceVersion: input.expectedPreferenceVersion,
        preference: createCanvasPersonalViewPreference({
          projectId: input.projectId,
          accountId: input.accountId,
          version: input.expectedPreferenceVersion + 1,
          lastScope: input.lastScope,
          scopeViews,
          updatedAt: now
        })
      });
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
          ...(input.canvas.scope === undefined ? {} : { scope: input.canvas.scope }),
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
