import {
  compareSceneDocuments,
  createEmptySceneDocument,
  hashSceneDocument,
  SceneDocumentValidationError,
  validateSceneDocumentV1,
  type SceneDocumentV1
} from "@ghostwriter/editor";
import {
  DomainValidationError,
  revisionId,
  sceneVariantId,
  type ProjectId,
  type RevisionId,
  type Scene,
  type SceneId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type {
  CreateNamedSceneVariantOutcome,
  CreateSceneCheckpointOutcome,
  InitializeSceneDocumentInput,
  RestoreSceneRevisionOutcome,
  SceneConditionalMutationConflictReason,
  SceneDocumentRepository,
  SaveWorkingSceneDocumentOutcome
} from "./scene-document-repository.js";
import {
  createSceneDocumentHead,
  createSceneRevision,
  InvalidSceneDocumentError,
  sceneContentHash,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  sceneLeaseHolderId,
  SceneNotFoundError,
  SceneRevisionNotFoundError,
  sceneRevisionMetadata,
  sceneVariantName,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError,
  type SceneDocumentHead,
  type SceneEditingLease,
  type SceneRevision,
  type SceneRevisionComparison,
  type SceneRevisionMetadata,
  type SceneVariant,
  type SceneWorkspace
} from "./scene-documents.js";
import type {
  Clock,
  IdGenerator,
  ProjectRepository
} from "./project-repository.js";

const DEFAULT_SCENE_LEASE_DURATION_MS = 60_000;

export type SceneCheckpointResult = Readonly<{
  head: SceneDocumentHead;
  revision: SceneRevisionMetadata;
  created: boolean;
}>;

export type NamedSceneVariantResult = Readonly<{
  head: SceneDocumentHead;
  revision: SceneRevisionMetadata;
  variant: SceneVariant;
  checkpointCreated: boolean;
}>;

export type RestoredSceneRevisionResult = Readonly<{
  head: SceneDocumentHead;
  revision: SceneRevisionMetadata;
}>;

export type SceneWritingServices = Readonly<{
  getSceneWorkspace(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
  }>): Promise<SceneWorkspace>;
  acquireOrRenewSceneLease(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
  }>): Promise<SceneEditingLease>;
  releaseSceneLease(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
  }>): Promise<void>;
  saveWorkingSceneDocument(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
    expectedWorkingVersion: number;
    document: unknown;
  }>): Promise<SceneDocumentHead>;
  listSceneRevisions(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
  }>): Promise<readonly SceneRevisionMetadata[]>;
  listNamedSceneVariants(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
  }>): Promise<readonly SceneVariant[]>;
  createManualCheckpoint(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
    expectedWorkingVersion: number;
  }>): Promise<SceneCheckpointResult>;
  createNamedSceneVariant(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
    expectedWorkingVersion: number;
    name: string;
  }>): Promise<NamedSceneVariantResult>;
  compareSceneRevisions(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    beforeRevisionId: RevisionId;
    afterRevisionId: RevisionId;
  }>): Promise<SceneRevisionComparison>;
  restoreSceneRevision(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sceneId: SceneId;
    sessionId: string;
    expectedWorkingVersion: number;
    revisionId: RevisionId;
  }>): Promise<RestoredSceneRevisionResult>;
}>;

export type SceneWritingServiceDependencies = Readonly<{
  projects: ProjectRepository;
  sceneDocuments: SceneDocumentRepository;
  ids: IdGenerator;
  clock: Clock;
  leaseDurationMs?: number;
}>;

async function requireOwnedScene(
  dependencies: SceneWritingServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  requestedSceneId: SceneId
): Promise<Scene> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new SceneNotFoundError();
    }
    throw error;
  }

  const scene = (await dependencies.projects.listScenes(projectId)).find(
    (candidate) =>
      candidate.id === requestedSceneId && candidate.projectId === projectId
  );
  if (scene === undefined) throw new SceneNotFoundError();
  return scene;
}

function leaseExpiry(now: string, durationMs: number): string {
  const nowMilliseconds = Date.parse(now);
  if (!Number.isFinite(nowMilliseconds)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "The scene service clock must return a valid timestamp."
    );
  }
  return new Date(nowMilliseconds + durationMs).toISOString();
}

function requireExpectedWorkingVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Expected scene working version must be a positive integer."
    );
  }
  return value;
}

async function initializeSceneDocument(
  dependencies: SceneWritingServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  requestedSceneId: SceneId
): Promise<SceneDocumentHead> {
  const existing = await dependencies.sceneDocuments.getHead(requestedSceneId);
  if (existing !== undefined) {
    if (existing.projectId !== projectId) throw new SceneNotFoundError();
    return existing;
  }

  const initial = await createInitialSceneDocumentState({
    projectId,
    sceneId: requestedSceneId,
    actorAccountId: accountId,
    ids: dependencies.ids,
    now: dependencies.clock.now()
  });
  return dependencies.sceneDocuments.initialize(initial);
}

export async function createInitialSceneDocumentState(input: {
  projectId: ProjectId;
  sceneId: SceneId;
  actorAccountId: AccountId;
  ids: IdGenerator;
  now: string;
}): Promise<InitializeSceneDocumentInput> {
  const newRevisionId = revisionId(input.ids.create("revision"));
  const document = createEmptySceneDocument({
    generateBlockId: () => input.ids.create("sceneDocumentBlock")
  });
  const contentHash = sceneContentHash(await hashSceneDocument(document));
  const genesisRevision = createSceneRevision({
    id: newRevisionId,
    sceneId: input.sceneId,
    projectId: input.projectId,
    document,
    contentHash,
    actorAccountId: input.actorAccountId,
    origin: "system",
    reason: "genesis",
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

async function ensureWorkspace(
  dependencies: SceneWritingServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  requestedSceneId: SceneId
): Promise<SceneWorkspace> {
  await requireOwnedScene(
    dependencies,
    accountId,
    projectId,
    requestedSceneId
  );
  const head = await initializeSceneDocument(
    dependencies,
    accountId,
    projectId,
    requestedSceneId
  );
  const lease = await dependencies.sceneDocuments.getLease(requestedSceneId);
  return Object.freeze({
    head,
    ...(lease === undefined ? {} : { lease })
  });
}

function mapConditionalMutationConflict(
  reason: SceneConditionalMutationConflictReason
): never {
  if (reason === "working-version-conflict") {
    throw new SceneWorkingVersionConflictError();
  }
  if (reason === "lease-expired") {
    throw new SceneLeaseExpiredError();
  }
  throw new SceneLeaseConflictError();
}

function mapSaveConflict(outcome: SaveWorkingSceneDocumentOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful scene save outcome.");
  }
  return mapConditionalMutationConflict(outcome.reason);
}

function mapCheckpointConflict(outcome: CreateSceneCheckpointOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful scene checkpoint outcome.");
  }
  return mapConditionalMutationConflict(outcome.reason);
}

function mapVariantConflict(outcome: CreateNamedSceneVariantOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful scene variant outcome.");
  }
  if (outcome.reason === "variant-name-conflict") {
    throw new SceneVariantNameConflictError();
  }
  return mapConditionalMutationConflict(outcome.reason);
}

function mapRestoreConflict(outcome: RestoreSceneRevisionOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful scene restore outcome.");
  }
  if (outcome.reason === "revision-not-found") {
    throw new SceneRevisionNotFoundError();
  }
  return mapConditionalMutationConflict(outcome.reason);
}

function requireRevisionInScene(
  revision: SceneRevision | undefined,
  projectId: ProjectId,
  sceneId: SceneId
): SceneRevision {
  if (
    revision === undefined ||
    revision.projectId !== projectId ||
    revision.sceneId !== sceneId
  ) {
    throw new SceneRevisionNotFoundError();
  }
  return revision;
}

export function createSceneWritingServices(
  dependencies: SceneWritingServiceDependencies
): SceneWritingServices {
  const leaseDurationMs =
    dependencies.leaseDurationMs ?? DEFAULT_SCENE_LEASE_DURATION_MS;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Scene lease duration must be a positive integer."
    );
  }

  return Object.freeze({
    getSceneWorkspace(input): Promise<SceneWorkspace> {
      return ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
    },
    async acquireOrRenewSceneLease(input): Promise<SceneEditingLease> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      const now = dependencies.clock.now();
      const outcome = await dependencies.sceneDocuments.acquireOrRenewLease({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId),
        now,
        expiresAt: leaseExpiry(now, leaseDurationMs)
      });
      if (!outcome.ok) throw new SceneLeaseConflictError();
      return outcome.lease;
    },
    async releaseSceneLease(input): Promise<void> {
      await requireOwnedScene(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      await dependencies.sceneDocuments.releaseLease({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId)
      });
    },
    async saveWorkingSceneDocument(input): Promise<SceneDocumentHead> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      requireExpectedWorkingVersion(input.expectedWorkingVersion);

      let document: SceneDocumentV1;
      try {
        document = validateSceneDocumentV1(input.document);
      } catch (error) {
        if (error instanceof SceneDocumentValidationError) {
          throw new InvalidSceneDocumentError();
        }
        throw error;
      }
      const outcome = await dependencies.sceneDocuments.saveWorkingDocument({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId),
        expectedWorkingVersion: input.expectedWorkingVersion,
        document,
        contentHash: sceneContentHash(await hashSceneDocument(document)),
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapSaveConflict(outcome);
      return outcome.head;
    },
    async listSceneRevisions(input): Promise<readonly SceneRevisionMetadata[]> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      return dependencies.sceneDocuments.listRevisions(input.sceneId);
    },
    async listNamedSceneVariants(input): Promise<readonly SceneVariant[]> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      return dependencies.sceneDocuments.listVariants(input.sceneId);
    },
    async createManualCheckpoint(input): Promise<SceneCheckpointResult> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      requireExpectedWorkingVersion(input.expectedWorkingVersion);
      const outcome = await dependencies.sceneDocuments.createManualCheckpoint({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId),
        expectedWorkingVersion: input.expectedWorkingVersion,
        revisionId: revisionId(dependencies.ids.create("revision")),
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapCheckpointConflict(outcome);
      return Object.freeze({
        head: outcome.head,
        revision: sceneRevisionMetadata(outcome.revision),
        created: outcome.created
      });
    },
    async createNamedSceneVariant(input): Promise<NamedSceneVariantResult> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      requireExpectedWorkingVersion(input.expectedWorkingVersion);
      const name = sceneVariantName(input.name);
      const outcome = await dependencies.sceneDocuments.createNamedVariant({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId),
        expectedWorkingVersion: input.expectedWorkingVersion,
        checkpointRevisionId: revisionId(
          dependencies.ids.create("revision")
        ),
        variantId: sceneVariantId(dependencies.ids.create("sceneVariant")),
        name,
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapVariantConflict(outcome);
      return Object.freeze({
        head: outcome.head,
        revision: sceneRevisionMetadata(outcome.revision),
        variant: outcome.variant,
        checkpointCreated: outcome.checkpointCreated
      });
    },
    async compareSceneRevisions(input): Promise<SceneRevisionComparison> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      const [beforeRevision, afterRevision] = await Promise.all([
        dependencies.sceneDocuments.getRevision(input.beforeRevisionId),
        dependencies.sceneDocuments.getRevision(input.afterRevisionId)
      ]);
      const before = requireRevisionInScene(
        beforeRevision,
        input.projectId,
        input.sceneId
      );
      const after = requireRevisionInScene(
        afterRevision,
        input.projectId,
        input.sceneId
      );
      return Object.freeze({
        beforeRevision: sceneRevisionMetadata(before),
        afterRevision: sceneRevisionMetadata(after),
        comparison: compareSceneDocuments(before.document, after.document)
      });
    },
    async restoreSceneRevision(
      input
    ): Promise<RestoredSceneRevisionResult> {
      await ensureWorkspace(
        dependencies,
        input.accountId,
        input.projectId,
        input.sceneId
      );
      requireExpectedWorkingVersion(input.expectedWorkingVersion);
      const outcome = await dependencies.sceneDocuments.restoreRevision({
        projectId: input.projectId,
        sceneId: input.sceneId,
        holderId: sceneLeaseHolderId(input.sessionId),
        expectedWorkingVersion: input.expectedWorkingVersion,
        sourceRevisionId: input.revisionId,
        restoredRevisionId: revisionId(dependencies.ids.create("revision")),
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapRestoreConflict(outcome);
      return Object.freeze({
        head: outcome.head,
        revision: sceneRevisionMetadata(outcome.revision)
      });
    }
  });
}
