import {
  createEmptySceneDocument,
  hashSceneDocument,
  SceneDocumentValidationError,
  validateSceneDocumentV1,
  type SceneDocumentV1
} from "@ghostwriter/editor";
import {
  captureId as toCaptureId,
  captureRevisionId,
  DomainValidationError,
  type CaptureId,
  type ProjectId
} from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type {
  CaptureDocumentRepository,
  InitializeCaptureDocumentInput,
  SaveWorkingCaptureDocumentOutcome,
  SetCaptureArchivedOutcome
} from "./capture-document-repository.js";
import {
  captureContentHash,
  CaptureArchivedMutationError,
  CaptureIntegratedMutationError,
  CaptureNotFoundError,
  CaptureVersionConflictError,
  createCaptureDocumentHead,
  createCaptureRevision,
  InvalidCaptureDocumentError,
  ProjectArchivedMutationError,
  type CaptureDocumentHead,
  type CaptureSourceModality,
  type CaptureSummary
} from "./capture-documents.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";

export type CaptureServices = Readonly<{
  createCapture(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    sourceModality: CaptureSourceModality;
  }>): Promise<CaptureDocumentHead>;
  getCapture(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureId: CaptureId;
  }>): Promise<CaptureDocumentHead>;
  listCaptures(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    includeArchived?: boolean;
  }>): Promise<readonly CaptureSummary[]>;
  saveCaptureDocument(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureId: CaptureId;
    expectedWorkingVersion: number;
    document: unknown;
  }>): Promise<CaptureDocumentHead>;
  setCaptureArchived(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureId: CaptureId;
    archived: boolean;
  }>): Promise<CaptureDocumentHead>;
}>;

export type CaptureServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  ids: IdGenerator;
  clock: Clock;
}>;

async function requireOwnedProjectRead(
  dependencies: CaptureServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
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
}

async function requireOwnedProjectMutation(
  dependencies: CaptureServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  await requireOwnedProjectRead(dependencies, accountId, projectId);
  const project = await dependencies.projects.getProject(projectId);
  if (project?.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
}

async function requireOwnedCapture(
  dependencies: CaptureServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  requestedCaptureId: CaptureId
): Promise<CaptureDocumentHead> {
  await requireOwnedProjectRead(dependencies, accountId, projectId);
  const head = await dependencies.captureDocuments.get(requestedCaptureId);
  if (head === undefined || head.projectId !== projectId) {
    throw new CaptureNotFoundError();
  }
  return head;
}

function requireExpectedWorkingVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Expected capture working version must be a positive integer."
    );
  }
  return value;
}

export async function createInitialCaptureDocumentState(input: {
  projectId: ProjectId;
  actorAccountId: AccountId;
  sourceModality: CaptureSourceModality;
  ids: IdGenerator;
  now: string;
}): Promise<InitializeCaptureDocumentInput> {
  const newCaptureId = toCaptureId(input.ids.create("capture"));
  const newRevisionId = captureRevisionId(input.ids.create("captureRevision"));
  const document = createEmptySceneDocument({
    generateBlockId: () => input.ids.create("captureDocumentBlock")
  });
  const contentHash = captureContentHash(await hashSceneDocument(document));
  const genesisRevision = createCaptureRevision({
    id: newRevisionId,
    captureId: newCaptureId,
    projectId: input.projectId,
    document,
    contentHash,
    actorAccountId: input.actorAccountId,
    origin: "system",
    reason: "genesis",
    createdAt: input.now
  });
  const head = createCaptureDocumentHead({
    captureId: newCaptureId,
    projectId: input.projectId,
    status: "draft",
    sourceModality: input.sourceModality,
    workingVersion: 1,
    document,
    contentHash,
    genesisRevisionId: newRevisionId,
    authorAccountId: input.actorAccountId,
    updatedByAccountId: input.actorAccountId,
    createdAt: input.now,
    updatedAt: input.now
  });
  return Object.freeze({ head, genesisRevision });
}

function mapSaveConflict(outcome: SaveWorkingCaptureDocumentOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful capture save outcome.");
  }
  if (outcome.reason === "working-version-conflict") {
    throw new CaptureVersionConflictError();
  }
  if (outcome.reason === "capture-integrated") {
    throw new CaptureIntegratedMutationError();
  }
  throw new CaptureArchivedMutationError();
}

function mapArchiveConflict(outcome: SetCaptureArchivedOutcome): never {
  if (outcome.ok) {
    throw new Error("Cannot map a successful capture archive outcome.");
  }
  if (outcome.reason === "capture-integrated") {
    throw new CaptureIntegratedMutationError();
  }
  throw new CaptureNotFoundError();
}

export function createCaptureServices(
  dependencies: CaptureServiceDependencies
): CaptureServices {
  return Object.freeze({
    async createCapture(input): Promise<CaptureDocumentHead> {
      await requireOwnedProjectMutation(
        dependencies,
        input.accountId,
        input.projectId
      );
      const initial = await createInitialCaptureDocumentState({
        projectId: input.projectId,
        actorAccountId: input.accountId,
        sourceModality: input.sourceModality,
        ids: dependencies.ids,
        now: dependencies.clock.now()
      });
      return dependencies.captureDocuments.initialize(initial);
    },
    async getCapture(input): Promise<CaptureDocumentHead> {
      return requireOwnedCapture(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
    },
    async listCaptures(input): Promise<readonly CaptureSummary[]> {
      await requireOwnedProjectRead(
        dependencies,
        input.accountId,
        input.projectId
      );
      return dependencies.captureDocuments.list(input.projectId, {
        includeArchived: input.includeArchived
      });
    },
    async saveCaptureDocument(input): Promise<CaptureDocumentHead> {
      await requireOwnedProjectMutation(
        dependencies,
        input.accountId,
        input.projectId
      );
      await requireOwnedCapture(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
      requireExpectedWorkingVersion(input.expectedWorkingVersion);

      let document: SceneDocumentV1;
      try {
        document = validateSceneDocumentV1(input.document);
      } catch (error) {
        if (error instanceof SceneDocumentValidationError) {
          throw new InvalidCaptureDocumentError();
        }
        throw error;
      }
      const outcome = await dependencies.captureDocuments.saveWorkingDocument({
        projectId: input.projectId,
        captureId: input.captureId,
        expectedWorkingVersion: input.expectedWorkingVersion,
        document,
        contentHash: captureContentHash(await hashSceneDocument(document)),
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapSaveConflict(outcome);
      return outcome.head;
    },
    async setCaptureArchived(input): Promise<CaptureDocumentHead> {
      await requireOwnedProjectMutation(
        dependencies,
        input.accountId,
        input.projectId
      );
      await requireOwnedCapture(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
      const outcome = await dependencies.captureDocuments.setArchived({
        projectId: input.projectId,
        captureId: input.captureId,
        archived: input.archived,
        actorAccountId: input.accountId,
        now: dependencies.clock.now()
      });
      if (!outcome.ok) return mapArchiveConflict(outcome);
      return outcome.head;
    }
  });
}
