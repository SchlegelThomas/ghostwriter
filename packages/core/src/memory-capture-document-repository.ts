import {
  DomainValidationError,
  type CaptureId,
  type CaptureRevisionId,
  type ProjectId
} from "./domain.js";
import type {
  CaptureDocumentRepository,
  InitializeCaptureDocumentInput,
  IntegrateCaptureDocumentInput,
  IntegrateCaptureDocumentOutcome,
  ListCapturesOptions,
  SaveWorkingCaptureDocumentInput,
  SaveWorkingCaptureDocumentOutcome,
  SetCaptureArchivedInput,
  SetCaptureArchivedOutcome
} from "./capture-document-repository.js";
import {
  captureSummaryFromHead,
  createCaptureDocumentHead,
  createCaptureRevision,
  isUntouchedEmptyGenesisCapture,
  type CaptureDocumentHead,
  type CaptureRevision,
  type CaptureStatus
} from "./capture-documents.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryCaptureDocumentState = {
  heads: Map<string, CaptureDocumentHead>;
  revisions: Map<string, CaptureRevision>;
};

function cloneMemoryCaptureDocumentState(
  state: MemoryCaptureDocumentState
): MemoryCaptureDocumentState {
  return {
    heads: new Map(
      [...state.heads].map(([id, head]) => [id, createCaptureDocumentHead(head)])
    ),
    revisions: new Map(
      [...state.revisions].map(([id, revision]) => [
        id,
        createCaptureRevision(revision)
      ])
    )
  };
}

function assertGenesis(input: InitializeCaptureDocumentInput): void {
  const { head, genesisRevision } = input;
  if (
    genesisRevision.reason !== "genesis" ||
    genesisRevision.parentRevisionId !== undefined ||
    head.genesisRevisionId !== genesisRevision.id ||
    head.captureId !== genesisRevision.captureId ||
    head.projectId !== genesisRevision.projectId ||
    head.contentHash !== genesisRevision.contentHash ||
    head.status !== "draft" ||
    head.archivedAt !== undefined
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A capture document must initialize from its matching genesis revision."
    );
  }
}

function shouldListCapture(
  head: CaptureDocumentHead,
  genesis: CaptureRevision,
  options: ListCapturesOptions
): boolean {
  if (isUntouchedEmptyGenesisCapture(head, genesis)) {
    return false;
  }
  if (head.status === "archived" && options.includeArchived !== true) {
    return false;
  }
  return true;
}

export function createMemoryCaptureDocumentRepository(): CaptureDocumentRepository {
  let state: MemoryCaptureDocumentState = {
    heads: new Map(),
    revisions: new Map()
  };
  let writeTail: Promise<void> = Promise.resolve();

  async function serializeWrite<Result>(
    operation: () => Result | Promise<Result>
  ): Promise<Result> {
    const previousWrite = writeTail;
    let release = (): void => undefined;
    writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  const repository: CaptureDocumentRepository & MemoryTransactionalRepository = {
    async get(captureId: CaptureId): Promise<CaptureDocumentHead | undefined> {
      const head = state.heads.get(captureId);
      return head === undefined ? undefined : createCaptureDocumentHead(head);
    },
    async getRevision(
      revisionId: CaptureRevisionId
    ): Promise<CaptureRevision | undefined> {
      const revision = state.revisions.get(revisionId);
      return revision === undefined ? undefined : createCaptureRevision(revision);
    },
    async list(projectId: ProjectId, options: ListCapturesOptions = {}) {
      const summaries = [];
      for (const head of state.heads.values()) {
        if (head.projectId !== projectId) continue;
        const genesis = state.revisions.get(head.genesisRevisionId);
        if (genesis === undefined) continue;
        if (!shouldListCapture(head, genesis, options)) continue;
        summaries.push(captureSummaryFromHead(head));
      }
      return summaries.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.captureId.localeCompare(left.captureId)
      );
    },
    initialize(input: InitializeCaptureDocumentInput): Promise<CaptureDocumentHead> {
      return serializeWrite(() => {
        assertGenesis(input);
        const existing = state.heads.get(input.head.captureId);
        if (existing !== undefined) return createCaptureDocumentHead(existing);

        const revision = createCaptureRevision(input.genesisRevision);
        const head = createCaptureDocumentHead(input.head);
        state.revisions.set(revision.id, revision);
        state.heads.set(head.captureId, head);
        return createCaptureDocumentHead(head);
      });
    },
    saveWorkingDocument(
      input: SaveWorkingCaptureDocumentInput
    ): Promise<SaveWorkingCaptureDocumentOutcome> {
      return serializeWrite(() => {
        const current = state.heads.get(input.captureId);
        if (
          current === undefined ||
          current.projectId !== input.projectId ||
          current.workingVersion !== input.expectedWorkingVersion
        ) {
          return { ok: false, reason: "working-version-conflict" };
        }
        if (current.status === "integrated") {
          return { ok: false, reason: "capture-integrated" };
        }
        if (current.status === "archived") {
          return { ok: false, reason: "capture-archived" };
        }

        const head = createCaptureDocumentHead({
          ...current,
          workingVersion: current.workingVersion + 1,
          document: input.document,
          contentHash: input.contentHash,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        });
        state.heads.set(input.captureId, head);
        return { ok: true, head: createCaptureDocumentHead(head) };
      });
    },
    setArchived(input: SetCaptureArchivedInput): Promise<SetCaptureArchivedOutcome> {
      return serializeWrite(() => {
        const current = state.heads.get(input.captureId);
        if (current === undefined || current.projectId !== input.projectId) {
          return { ok: false, reason: "not-found" };
        }
        if (current.status === "integrated") {
          return { ok: false, reason: "capture-integrated" };
        }

        const nextStatus: CaptureStatus = input.archived ? "archived" : "draft";
        if (current.status === nextStatus) {
          return { ok: true, head: createCaptureDocumentHead(current) };
        }

        const head = input.archived
          ? createCaptureDocumentHead({
              ...current,
              status: "archived",
              archivedAt: input.now,
              updatedByAccountId: input.actorAccountId,
              updatedAt: input.now
            })
          : createCaptureDocumentHead({
              captureId: current.captureId,
              projectId: current.projectId,
              status: "draft",
              sourceModality: current.sourceModality,
              workingVersion: current.workingVersion,
              document: current.document,
              contentHash: current.contentHash,
              genesisRevisionId: current.genesisRevisionId,
              authorAccountId: current.authorAccountId,
              updatedByAccountId: input.actorAccountId,
              createdAt: current.createdAt,
              updatedAt: input.now
            });
        state.heads.set(input.captureId, head);
        return { ok: true, head: createCaptureDocumentHead(head) };
      });
    },
    integrate(
      input: IntegrateCaptureDocumentInput
    ): Promise<IntegrateCaptureDocumentOutcome> {
      return serializeWrite(() => {
        const current = state.heads.get(input.captureId);
        if (current === undefined || current.projectId !== input.projectId) {
          return { ok: false, reason: "not-found" };
        }
        if (current.workingVersion !== input.expectedWorkingVersion) {
          return { ok: false, reason: "working-version-conflict" };
        }
        if (current.contentHash !== input.expectedContentHash) {
          return { ok: false, reason: "content-hash-mismatch" };
        }
        if (current.status === "integrated") {
          return { ok: false, reason: "capture-integrated" };
        }
        if (current.status === "archived") {
          return { ok: false, reason: "capture-archived" };
        }
        if (
          input.integrationRevision.captureId !== current.captureId ||
          input.integrationRevision.projectId !== current.projectId ||
          input.integrationRevision.reason !== "integration" ||
          input.integrationRevision.parentRevisionId !== current.genesisRevisionId ||
          input.integrationRevision.contentHash !== current.contentHash ||
          state.revisions.has(input.integrationRevision.id)
        ) {
          throw new DomainValidationError(
            "UNKNOWN_REFERENCE",
            "Capture integration revision must match the promoted head."
          );
        }

        const revision = createCaptureRevision(input.integrationRevision);
        const head = createCaptureDocumentHead({
          ...current,
          status: "integrated",
          integrationRevisionId: revision.id,
          integratedSceneId: input.integratedSceneId,
          integratedAt: input.now,
          integratedByAccountId: input.actorAccountId,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        });
        state.revisions.set(revision.id, revision);
        state.heads.set(input.captureId, head);
        return {
          ok: true,
          head: createCaptureDocumentHead(head),
          revision: createCaptureRevision(revision)
        };
      });
    }
  };
  repository[MEMORY_TRANSACTION_STATE] = Object.freeze({
    snapshot: () => cloneMemoryCaptureDocumentState(state),
    restore(snapshot: unknown): void {
      state = cloneMemoryCaptureDocumentState(snapshot as MemoryCaptureDocumentState);
    }
  });
  return Object.freeze(repository);
}
