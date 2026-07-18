import {
  DomainValidationError,
  type RevisionId,
  type SceneId
} from "./domain.js";
import type {
  AcquireSceneLeaseOutcome,
  AcquireSceneLeaseInput,
  CreateNamedSceneVariantInput,
  CreateNamedSceneVariantOutcome,
  CreateSceneCheckpointInput,
  CreateSceneCheckpointOutcome,
  InitializeSceneDocumentInput,
  ReleaseSceneLeaseInput,
  RestoreSceneRevisionInput,
  RestoreSceneRevisionOutcome,
  SaveWorkingSceneDocumentInput,
  SaveWorkingSceneDocumentOutcome,
  SceneConditionalMutationConflictReason,
  SceneDocumentRepository
} from "./scene-document-repository.js";
import {
  createSceneDocumentHead,
  createSceneEditingLease,
  createSceneRevision,
  createSceneVariant,
  sceneRevisionMetadata,
  type SceneDocumentHead,
  type SceneEditingLease,
  type SceneRevision,
  type SceneVariant
} from "./scene-documents.js";
import type { SceneVariantId } from "./domain.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemorySceneDocumentState = {
  heads: Map<string, SceneDocumentHead>;
  revisions: Map<string, SceneRevision>;
  variants: Map<string, SceneVariant>;
  leases: Map<string, SceneEditingLease>;
};

function cloneMemorySceneDocumentState(
  state: MemorySceneDocumentState
): MemorySceneDocumentState {
  return {
    heads: new Map(
      [...state.heads].map(([id, head]) => [id, createSceneDocumentHead(head)])
    ),
    revisions: new Map(
      [...state.revisions].map(([id, revision]) => [
        id,
        createSceneRevision(revision)
      ])
    ),
    variants: new Map(
      [...state.variants].map(([id, variant]) => [
        id,
        createSceneVariant(variant)
      ])
    ),
    leases: new Map(
      [...state.leases].map(([id, lease]) => [
        id,
        createSceneEditingLease(lease)
      ])
    )
  };
}

function expiresAtOrBefore(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

function assertGenesis(input: InitializeSceneDocumentInput): void {
  const { head, genesisRevision } = input;
  if (
    genesisRevision.reason !== "genesis" ||
    genesisRevision.parentRevisionId !== undefined ||
    head.checkpointRevisionId !== genesisRevision.id ||
    head.sceneId !== genesisRevision.sceneId ||
    head.projectId !== genesisRevision.projectId ||
    head.contentHash !== genesisRevision.contentHash
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A scene document must initialize from its matching genesis revision."
    );
  }
}

type ConditionalSceneMutationInput =
  | CreateSceneCheckpointInput
  | CreateNamedSceneVariantInput
  | RestoreSceneRevisionInput;

function conditionalMutationConflict(
  state: MemorySceneDocumentState,
  input: ConditionalSceneMutationInput
): SceneConditionalMutationConflictReason | undefined {
  const current = state.heads.get(input.sceneId);
  if (
    current === undefined ||
    current.projectId !== input.projectId ||
    current.workingVersion !== input.expectedWorkingVersion
  ) {
    return "working-version-conflict";
  }

  const lease = state.leases.get(input.sceneId);
  if (
    lease === undefined ||
    lease.projectId !== input.projectId ||
    lease.holderId !== input.holderId
  ) {
    return "lease-conflict";
  }
  return expiresAtOrBefore(lease.expiresAt, input.now)
    ? "lease-expired"
    : undefined;
}

function checkpointCurrentHead(
  state: MemorySceneDocumentState,
  input: ConditionalSceneMutationInput,
  newRevisionId: RevisionId
): Readonly<{
  head: SceneDocumentHead;
  revision: SceneRevision;
  created: boolean;
}> {
  const current = state.heads.get(input.sceneId);
  if (current === undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The scene document head does not exist."
    );
  }
  const checkpoint = state.revisions.get(current.checkpointRevisionId);
  if (
    checkpoint === undefined ||
    checkpoint.sceneId !== current.sceneId ||
    checkpoint.projectId !== current.projectId
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The scene checkpoint head does not exist."
    );
  }
  if (checkpoint.contentHash === current.contentHash) {
    return {
      head: createSceneDocumentHead(current),
      revision: createSceneRevision(checkpoint),
      created: false
    };
  }
  if (state.revisions.has(newRevisionId)) {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The scene revision ID already exists."
    );
  }

  const revision = createSceneRevision({
    id: newRevisionId,
    sceneId: current.sceneId,
    projectId: current.projectId,
    parentRevisionId: current.checkpointRevisionId,
    document: current.document,
    contentHash: current.contentHash,
    actorAccountId: input.actorAccountId,
    origin: "human",
    reason: "checkpoint",
    createdAt: input.now
  });
  const head = createSceneDocumentHead({
    ...current,
    workingVersion: current.workingVersion + 1,
    checkpointRevisionId: revision.id,
    updatedByAccountId: input.actorAccountId,
    updatedAt: input.now
  });
  state.revisions.set(revision.id, revision);
  state.heads.set(head.sceneId, head);
  return {
    head: createSceneDocumentHead(head),
    revision: createSceneRevision(revision),
    created: true
  };
}

export function createMemorySceneDocumentRepository(): SceneDocumentRepository {
  let state: MemorySceneDocumentState = {
    heads: new Map(),
    revisions: new Map(),
    variants: new Map(),
    leases: new Map()
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

  const repository: SceneDocumentRepository & MemoryTransactionalRepository = {
    async getHead(sceneId: SceneId): Promise<SceneDocumentHead | undefined> {
      const head = state.heads.get(sceneId);
      return head === undefined ? undefined : createSceneDocumentHead(head);
    },
    async getHeads(
      sceneIds: readonly SceneId[]
    ): Promise<ReadonlyMap<SceneId, SceneDocumentHead>> {
      const heads = new Map<SceneId, SceneDocumentHead>();
      for (const sceneId of sceneIds) {
        const head = state.heads.get(sceneId);
        if (head !== undefined) {
          heads.set(sceneId, createSceneDocumentHead(head));
        }
      }
      return heads;
    },
    async getRevision(revisionId: RevisionId): Promise<SceneRevision | undefined> {
      const revision = state.revisions.get(revisionId);
      return revision === undefined ? undefined : createSceneRevision(revision);
    },
    async getVariant(
      variantId: SceneVariantId
    ): Promise<SceneVariant | undefined> {
      const variant = state.variants.get(variantId);
      return variant === undefined ? undefined : createSceneVariant(variant);
    },
    async listRevisions(sceneId: SceneId) {
      return [...state.revisions.values()]
        .filter((revision) => revision.sceneId === sceneId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id)
        )
        .map(sceneRevisionMetadata);
    },
    async listVariants(sceneId: SceneId) {
      return [...state.variants.values()]
        .filter((variant) => variant.sceneId === sceneId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id)
        )
        .map(createSceneVariant);
    },
    async getLease(sceneId: SceneId): Promise<SceneEditingLease | undefined> {
      const lease = state.leases.get(sceneId);
      return lease === undefined ? undefined : createSceneEditingLease(lease);
    },
    initialize(input: InitializeSceneDocumentInput): Promise<SceneDocumentHead> {
      return serializeWrite(() => {
        assertGenesis(input);
        const existing = state.heads.get(input.head.sceneId);
        if (existing !== undefined) return createSceneDocumentHead(existing);

        const revision = createSceneRevision(input.genesisRevision);
        const head = createSceneDocumentHead(input.head);
        state.revisions.set(revision.id, revision);
        state.heads.set(head.sceneId, head);
        return createSceneDocumentHead(head);
      });
    },
    acquireOrRenewLease(
      input: AcquireSceneLeaseInput
    ): Promise<AcquireSceneLeaseOutcome> {
      return serializeWrite(() => {
        const existing = state.leases.get(input.sceneId);
        const expired =
          existing === undefined ||
          expiresAtOrBefore(existing.expiresAt, input.now);
        if (
          existing !== undefined &&
          existing.holderId !== input.holderId &&
          !expired
        ) {
          return { ok: false, reason: "lease-conflict" };
        }

        const lease = createSceneEditingLease({
          projectId: input.projectId,
          sceneId: input.sceneId,
          holderId: input.holderId,
          acquiredAt:
            existing !== undefined &&
            existing.holderId === input.holderId &&
            !expired
              ? existing.acquiredAt
              : input.now,
          renewedAt: input.now,
          expiresAt: input.expiresAt
        });
        state.leases.set(input.sceneId, lease);
        return { ok: true, lease: createSceneEditingLease(lease) };
      });
    },
    releaseLease(input: ReleaseSceneLeaseInput): Promise<boolean> {
      return serializeWrite(() => {
        const existing = state.leases.get(input.sceneId);
        if (
          existing === undefined ||
          existing.projectId !== input.projectId ||
          existing.holderId !== input.holderId
        ) {
          return false;
        }
        state.leases.delete(input.sceneId);
        return true;
      });
    },
    saveWorkingDocument(
      input: SaveWorkingSceneDocumentInput
    ): Promise<SaveWorkingSceneDocumentOutcome> {
      return serializeWrite(() => {
        const current = state.heads.get(input.sceneId);
        if (
          current === undefined ||
          current.projectId !== input.projectId ||
          current.workingVersion !== input.expectedWorkingVersion
        ) {
          return { ok: false, reason: "working-version-conflict" };
        }

        const lease = state.leases.get(input.sceneId);
        if (
          lease === undefined ||
          lease.projectId !== input.projectId ||
          lease.holderId !== input.holderId
        ) {
          return { ok: false, reason: "lease-conflict" };
        }
        if (expiresAtOrBefore(lease.expiresAt, input.now)) {
          return { ok: false, reason: "lease-expired" };
        }

        const head = createSceneDocumentHead({
          ...current,
          workingVersion: current.workingVersion + 1,
          document: input.document,
          contentHash: input.contentHash,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        });
        state.heads.set(input.sceneId, head);
        return { ok: true, head: createSceneDocumentHead(head) };
      });
    },
    createManualCheckpoint(
      input: CreateSceneCheckpointInput
    ): Promise<CreateSceneCheckpointOutcome> {
      return serializeWrite(() => {
        const conflict = conditionalMutationConflict(state, input);
        if (conflict !== undefined) return { ok: false, reason: conflict };
        const checkpoint = checkpointCurrentHead(
          state,
          input,
          input.revisionId
        );
        return { ok: true, ...checkpoint };
      });
    },
    createNamedVariant(
      input: CreateNamedSceneVariantInput
    ): Promise<CreateNamedSceneVariantOutcome> {
      return serializeWrite(() => {
        const conflict = conditionalMutationConflict(state, input);
        if (conflict !== undefined) return { ok: false, reason: conflict };
        const duplicateName = [...state.variants.values()].some(
          (variant) =>
            variant.sceneId === input.sceneId && variant.name === input.name
        );
        if (duplicateName) {
          return { ok: false, reason: "variant-name-conflict" };
        }
        if (state.variants.has(input.variantId)) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The scene variant ID already exists."
          );
        }
        const current = state.heads.get(input.sceneId);
        if (current === undefined) {
          return { ok: false, reason: "working-version-conflict" };
        }
        const validatedVariant = createSceneVariant({
          id: input.variantId,
          projectId: input.projectId,
          sceneId: input.sceneId,
          revisionId: current.checkpointRevisionId,
          creatorAccountId: input.actorAccountId,
          name: input.name,
          createdAt: input.now,
          updatedAt: input.now
        });

        const checkpoint = checkpointCurrentHead(
          state,
          input,
          input.checkpointRevisionId
        );
        const variant = createSceneVariant({
          ...validatedVariant,
          revisionId: checkpoint.revision.id,
        });
        state.variants.set(variant.id, variant);
        return {
          ok: true,
          head: checkpoint.head,
          revision: checkpoint.revision,
          variant: createSceneVariant(variant),
          checkpointCreated: checkpoint.created
        };
      });
    },
    restoreRevision(
      input: RestoreSceneRevisionInput
    ): Promise<RestoreSceneRevisionOutcome> {
      return serializeWrite(() => {
        const conflict = conditionalMutationConflict(state, input);
        if (conflict !== undefined) return { ok: false, reason: conflict };
        const current = state.heads.get(input.sceneId);
        if (current === undefined) {
          return { ok: false, reason: "working-version-conflict" };
        }
        const source = state.revisions.get(input.sourceRevisionId);
        if (
          source === undefined ||
          source.sceneId !== input.sceneId ||
          source.projectId !== input.projectId
        ) {
          return { ok: false, reason: "revision-not-found" };
        }
        if (state.revisions.has(input.restoredRevisionId)) {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The restored scene revision ID already exists."
          );
        }

        const revision = createSceneRevision({
          id: input.restoredRevisionId,
          sceneId: input.sceneId,
          projectId: input.projectId,
          parentRevisionId: current.checkpointRevisionId,
          document: source.document,
          contentHash: source.contentHash,
          actorAccountId: input.actorAccountId,
          origin: "human",
          reason: "restore",
          createdAt: input.now
        });
        const head = createSceneDocumentHead({
          ...current,
          workingVersion: current.workingVersion + 1,
          document: source.document,
          contentHash: source.contentHash,
          checkpointRevisionId: revision.id,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        });
        state.revisions.set(revision.id, revision);
        state.heads.set(head.sceneId, head);
        return {
          ok: true,
          head: createSceneDocumentHead(head),
          revision: createSceneRevision(revision)
        };
      });
    }
  };
  repository[MEMORY_TRANSACTION_STATE] = Object.freeze({
    snapshot: () => cloneMemorySceneDocumentState(state),
    restore(snapshot: unknown): void {
      state = cloneMemorySceneDocumentState(
        snapshot as MemorySceneDocumentState
      );
    }
  });
  return Object.freeze(repository);
}
