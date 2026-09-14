import {
  canvasRevisionMetadata,
  canvasPersonalScopeKey,
  createCanvasBoard,
  createCanvasPersonalScopeView,
  createCanvasPersonalViewPreference,
  createCanvasRevision,
  createCanvasViewportPreference,
  validateCanvasBoardReferences,
  CanvasPreferenceVersionConflictError,
  CanvasVersionConflictError,
  type CanvasBoard,
  type CanvasPersonalViewPreference,
  type CanvasRevision,
  type CanvasViewportPreference
} from "./canvas.js";
import type {
  CanvasRepository,
  CanvasSceneCreationUnitOfWork,
  CommitCanvasSceneCreationInput
} from "./canvas-repository.js";
import {
  DomainValidationError,
  validateProjectRecords,
  type ProjectId
} from "./domain.js";
import { requireProjectOwner, type AccountId } from "./identity.js";
import {
  ProjectVersionConflictError,
  type ProjectRepository
} from "./project-repository.js";
import type { SceneDocumentRepository } from "./scene-document-repository.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryCanvasState = {
  boards: Map<string, CanvasBoard>;
  revisions: Map<string, CanvasRevision>;
  preferences: Map<string, CanvasViewportPreference>;
  personalPreferences: Map<string, CanvasPersonalViewPreference>;
};

function cloneMemoryCanvasState(state: MemoryCanvasState): MemoryCanvasState {
  return {
    boards: new Map(
      [...state.boards].map(([id, board]) => [id, createCanvasBoard(board)])
    ),
    revisions: new Map(
      [...state.revisions].map(([id, revision]) => [
        id,
        createCanvasRevision(revision)
      ])
    ),
    preferences: new Map(
      [...state.preferences].map(([key, preference]) => [
        key,
        createCanvasViewportPreference(preference)
      ])
    ),
    personalPreferences: new Map(
      [...state.personalPreferences].map(([key, preference]) => [
        key,
        createCanvasPersonalViewPreference(preference)
      ])
    )
  };
}

function preferenceKey(projectId: ProjectId, accountId: AccountId): string {
  return `${projectId}:${accountId}`;
}

function assertMutationShape(input: {
  board: CanvasBoard;
  revision: CanvasRevision;
}): void {
  if (
    input.revision.projectId !== input.board.projectId ||
    input.revision.boardVersion !== input.board.version ||
    input.revision.snapshot.version !== input.board.version ||
    JSON.stringify(input.revision.snapshot) !== JSON.stringify(input.board)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Canvas mutation revision does not match its board."
    );
  }
}

export function createMemoryCanvasRepository(): CanvasRepository {
  let state: MemoryCanvasState = {
    boards: new Map(),
    revisions: new Map(),
    preferences: new Map(),
    personalPreferences: new Map()
  };
  let writeTail: Promise<void> = Promise.resolve();

  async function serialize<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previous = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  const repository: CanvasRepository & MemoryTransactionalRepository = {
    async getBoard(projectId: ProjectId): Promise<CanvasBoard | undefined> {
      const board = state.boards.get(projectId);
      return board === undefined ? undefined : createCanvasBoard(board);
    },
    initialize(input): Promise<CanvasBoard> {
      return serialize(() => {
        const existing = state.boards.get(input.board.projectId);
        if (existing !== undefined) return createCanvasBoard(existing);
        const board = createCanvasBoard(input.board);
        const revision = createCanvasRevision(input.revision);
        assertMutationShape({ board, revision });
        if (board.version !== 1 || revision.reason !== "genesis") {
          throw new DomainValidationError(
            "INVALID_VERSION",
            "A new Canvas must initialize at version one with a genesis revision."
          );
        }
        if (state.revisions.has(revision.id)) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "Canvas revision already exists."
          );
        }
        state.boards.set(board.projectId, board);
        state.revisions.set(revision.id, revision);
        return createCanvasBoard(board);
      });
    },
    replace(input): Promise<CanvasBoard> {
      return serialize(() => {
        const board = createCanvasBoard(input.mutation.board);
        const revision = createCanvasRevision(input.mutation.revision);
        assertMutationShape({ board, revision });
        const current = state.boards.get(board.projectId);
        if (
          current === undefined ||
          current.version !== input.expectedCanvasVersion
        ) {
          throw new CanvasVersionConflictError(
            board.projectId,
            input.expectedCanvasVersion
          );
        }
        if (board.version !== input.expectedCanvasVersion + 1) {
          throw new DomainValidationError(
            "INVALID_VERSION",
            "A Canvas replacement must increment its version exactly once."
          );
        }
        if (state.revisions.has(revision.id)) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "Canvas revision already exists."
          );
        }
        state.boards.set(board.projectId, board);
        state.revisions.set(revision.id, revision);
        return createCanvasBoard(board);
      });
    },
    async getRevision(projectId, revisionId) {
      const revision = state.revisions.get(revisionId);
      return revision === undefined || revision.projectId !== projectId
        ? undefined
        : createCanvasRevision(revision);
    },
    async listRevisions(projectId, options) {
      if (options?.limit !== undefined &&
          (!Number.isInteger(options.limit) || options.limit < 1)) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Canvas revision page size must be a positive integer."
        );
      }
      if (options?.beforeVersion !== undefined &&
          (!Number.isInteger(options.beforeVersion) || options.beforeVersion < 1)) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "Canvas revision cursor must be a positive integer."
        );
      }
      const revisions = [...state.revisions.values()]
        .filter((revision) => revision.projectId === projectId)
        .filter((revision) =>
          options?.beforeVersion === undefined ||
          revision.boardVersion < options.beforeVersion
        )
        .sort(
          (left, right) =>
            right.boardVersion - left.boardVersion ||
            right.createdAt.localeCompare(left.createdAt)
        )
        .map(canvasRevisionMetadata);
      return options?.limit === undefined
        ? revisions
        : revisions.slice(0, options.limit);
    },
    async getViewportPreference(projectId, accountId) {
      const preference = state.preferences.get(
        preferenceKey(projectId, accountId)
      );
      return preference === undefined
        ? undefined
        : createCanvasViewportPreference(preference);
    },
    saveViewportPreference(preference): Promise<CanvasViewportPreference> {
      return serialize(() => {
        const validated = createCanvasViewportPreference(preference);
        const key = preferenceKey(validated.projectId, validated.accountId);
        state.preferences.set(key, validated);
        const current = state.personalPreferences.get(key);
        const projectView = createCanvasPersonalScopeView({
          scope: { scopeKind: "project" },
          viewport: { x: validated.x, y: validated.y, zoom: validated.zoom },
          viewMode: "spatial",
          inspectorOpen: false,
          focusToken: "surface",
          ...(validated.selectedObjectId === undefined
            ? {}
            : { selectedObjectId: validated.selectedObjectId }),
          workflowLens: "outline",
          updatedAt: validated.updatedAt
        });
        const views = new Map(
          (current?.scopeViews ?? []).map((view) => [
            canvasPersonalScopeKey(view.scope),
            view
          ])
        );
        views.set("project", projectView);
        state.personalPreferences.set(
          key,
          createCanvasPersonalViewPreference({
            projectId: validated.projectId,
            accountId: validated.accountId,
            version: (current?.version ?? 0) + 1,
            lastScope: current?.lastScope ?? { scopeKind: "project" },
            scopeViews: [...views.values()],
            updatedAt: validated.updatedAt
          })
        );
        return createCanvasViewportPreference(validated);
      });
    },
    async getPersonalViewPreference(projectId, accountId) {
      const preference = state.personalPreferences.get(
        preferenceKey(projectId, accountId)
      );
      return preference === undefined
        ? undefined
        : createCanvasPersonalViewPreference(preference);
    },
    savePersonalViewPreference(input): Promise<CanvasPersonalViewPreference> {
      return serialize(() => {
        const validated = createCanvasPersonalViewPreference(input.preference);
        const key = preferenceKey(validated.projectId, validated.accountId);
        const current = state.personalPreferences.get(key);
        if (
          (current?.version ?? 0) !== input.expectedPreferenceVersion ||
          validated.version !== input.expectedPreferenceVersion + 1
        ) {
          throw new CanvasPreferenceVersionConflictError(
            validated.projectId,
            input.expectedPreferenceVersion
          );
        }
        state.personalPreferences.set(key, validated);
        const projectView = validated.scopeViews.find(
          (view) => canvasPersonalScopeKey(view.scope) === "project"
        )!;
        state.preferences.set(
          key,
          createCanvasViewportPreference({
            projectId: validated.projectId,
            accountId: validated.accountId,
            ...projectView.viewport,
            ...(projectView.selectedObjectId === undefined
              ? {}
              : { selectedObjectId: projectView.selectedObjectId }),
            updatedAt: validated.updatedAt
          })
        );
        return createCanvasPersonalViewPreference(validated);
      });
    }
  };
  repository[MEMORY_TRANSACTION_STATE] = Object.freeze({
    snapshot: () => cloneMemoryCanvasState(state),
    restore(snapshot: unknown): void {
      state = cloneMemoryCanvasState(snapshot as MemoryCanvasState);
    }
  });
  return Object.freeze(repository);
}

function assertCombinedCreation(
  input: CommitCanvasSceneCreationInput,
  currentProjectVersion: number,
  currentCanvasVersion: number
): void {
  validateProjectRecords(input.projectRecords);
  validateCanvasBoardReferences(
    input.canvasMutation.board,
    input.projectRecords
  );
  if (input.projectRecords.project.version !== currentProjectVersion + 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Canvas scene creation must increment the project version exactly once."
    );
  }
  if (input.canvasMutation.board.version !== currentCanvasVersion + 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Canvas scene creation must increment the Canvas version exactly once."
    );
  }
  if (
    input.sceneDocument.head.projectId !== input.projectRecords.project.id ||
    input.sceneDocument.genesisRevision.projectId !==
      input.projectRecords.project.id ||
    input.sceneDocument.head.sceneId !==
      input.sceneDocument.genesisRevision.sceneId ||
    !input.projectRecords.scenes.some(
      (scene) => scene.id === input.sceneDocument.head.sceneId
    )
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Canvas scene creation must initialize the scene added to the project."
    );
  }
}

/**
 * The memory implementation serializes and completely preflights the three
 * deterministic writes before publishing them. It is a test adapter, not a
 * browser or production canonical store.
 */
export function createMemoryCanvasSceneCreationUnitOfWork(dependencies: {
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  canvases: CanvasRepository;
}): CanvasSceneCreationUnitOfWork {
  let transactionTail: Promise<void> = Promise.resolve();
  const participants = [
    dependencies.projects,
    dependencies.sceneDocuments,
    dependencies.canvases
  ].map((repository) => {
    const participant = (repository as MemoryTransactionalRepository)[
      MEMORY_TRANSACTION_STATE
    ];
    if (participant === undefined) {
      throw new Error(
        "Memory Canvas scene creation requires memory repository participants."
      );
    }
    return participant;
  });

  return Object.freeze({
    async commitSceneFromCanvas(
      input: CommitCanvasSceneCreationInput
    ): Promise<void> {
      const previous = transactionTail;
      let release = (): void => undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = participants.map((participant) =>
        participant.snapshot()
      );

      try {
        requireProjectOwner(
          input.projectRecords.project.id,
          await dependencies.projects.getProjectMembership(
            input.projectRecords.project.id,
            input.accountId
          )
        );
        const currentProject = await dependencies.projects.getProject(
          input.projectRecords.project.id
        );
        if (
          currentProject === undefined ||
          currentProject.version !== input.expectedProjectVersion
        ) {
          throw new ProjectVersionConflictError(
            input.projectRecords.project.id,
            input.expectedProjectVersion
          );
        }
        const currentCanvas = await dependencies.canvases.getBoard(
          input.projectRecords.project.id
        );
        if (
          currentCanvas === undefined ||
          currentCanvas.version !== input.expectedCanvasVersion
        ) {
          throw new CanvasVersionConflictError(
            input.projectRecords.project.id,
            input.expectedCanvasVersion
          );
        }
        if (
          (await dependencies.sceneDocuments.getHead(
            input.sceneDocument.head.sceneId
          )) !== undefined
        ) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The scene document already exists."
          );
        }
        if (
          (await dependencies.canvases.getRevision(
            input.projectRecords.project.id,
            input.canvasMutation.revision.id
          )) !== undefined
        ) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The Canvas revision already exists."
          );
        }
        assertCombinedCreation(
          input,
          currentProject.version,
          currentCanvas.version
        );

        await dependencies.projects.transaction((writer) => {
          writer.replaceProjectRecords(
            input.projectRecords,
            input.expectedProjectVersion
          );
        });
        await dependencies.sceneDocuments.initialize(input.sceneDocument);
        await dependencies.canvases.replace({
          mutation: input.canvasMutation,
          expectedCanvasVersion: input.expectedCanvasVersion
        });
      } catch (error) {
        participants.forEach((participant, index) => {
          participant.restore(snapshots[index]);
        });
        throw error;
      } finally {
        release();
      }
    }
  });
}
