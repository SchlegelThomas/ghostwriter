import type {
  ProjectId,
  RevisionId,
  SceneId,
  SceneVariantId
} from "./domain.js";
import type { AccountId } from "./identity.js";
import type {
  SceneContentHash,
  SceneDocumentHead,
  SceneEditingLease,
  SceneLeaseHolderId,
  SceneRevision,
  SceneRevisionMetadata,
  SceneVariant
} from "./scene-documents.js";
import type { SceneDocumentV1 } from "@ghostwriter/editor";

export type AcquireSceneLeaseOutcome =
  | Readonly<{ ok: true; lease: SceneEditingLease }>
  | Readonly<{ ok: false; reason: "lease-conflict" }>;

export type SaveWorkingSceneDocumentOutcome =
  | Readonly<{ ok: true; head: SceneDocumentHead }>
  | Readonly<{
      ok: false;
      reason:
        | "working-version-conflict"
        | "lease-conflict"
        | "lease-expired";
    }>;

export type SceneConditionalMutationConflictReason =
  | "working-version-conflict"
  | "lease-conflict"
  | "lease-expired";

export type CreateSceneCheckpointOutcome =
  | Readonly<{
      ok: true;
      head: SceneDocumentHead;
      revision: SceneRevision;
      created: boolean;
    }>
  | Readonly<{
      ok: false;
      reason: SceneConditionalMutationConflictReason;
    }>;

export type CreateNamedSceneVariantOutcome =
  | Readonly<{
      ok: true;
      head: SceneDocumentHead;
      revision: SceneRevision;
      variant: SceneVariant;
      checkpointCreated: boolean;
    }>
  | Readonly<{
      ok: false;
      reason:
        | SceneConditionalMutationConflictReason
        | "variant-name-conflict";
    }>;

export type RestoreSceneRevisionOutcome =
  | Readonly<{
      ok: true;
      head: SceneDocumentHead;
      revision: SceneRevision;
    }>
  | Readonly<{
      ok: false;
      reason:
        | SceneConditionalMutationConflictReason
        | "revision-not-found";
    }>;

export type InitializeSceneDocumentInput = Readonly<{
  head: SceneDocumentHead;
  genesisRevision: SceneRevision;
}>;

export type AcquireSceneLeaseInput = Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
  holderId: SceneLeaseHolderId;
  now: string;
  expiresAt: string;
}>;

export type ReleaseSceneLeaseInput = Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
  holderId: SceneLeaseHolderId;
}>;

export type SaveWorkingSceneDocumentInput = Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
  holderId: SceneLeaseHolderId;
  expectedWorkingVersion: number;
  document: SceneDocumentV1;
  contentHash: SceneContentHash;
  actorAccountId: AccountId;
  now: string;
}>;

type SceneConditionalMutationInput = Readonly<{
  projectId: ProjectId;
  sceneId: SceneId;
  holderId: SceneLeaseHolderId;
  expectedWorkingVersion: number;
  actorAccountId: AccountId;
  now: string;
}>;

export type CreateSceneCheckpointInput = SceneConditionalMutationInput &
  Readonly<{
    revisionId: RevisionId;
  }>;

export type CreateNamedSceneVariantInput = SceneConditionalMutationInput &
  Readonly<{
    checkpointRevisionId: RevisionId;
    variantId: SceneVariantId;
    name: string;
  }>;

export type RestoreSceneRevisionInput = SceneConditionalMutationInput &
  Readonly<{
    sourceRevisionId: RevisionId;
    restoredRevisionId: RevisionId;
  }>;

export interface SceneDocumentRepository {
  getHead(sceneId: SceneId): Promise<SceneDocumentHead | undefined>;
  getRevision(revisionId: RevisionId): Promise<SceneRevision | undefined>;
  getVariant(variantId: SceneVariantId): Promise<SceneVariant | undefined>;
  listRevisions(sceneId: SceneId): Promise<readonly SceneRevisionMetadata[]>;
  listVariants(sceneId: SceneId): Promise<readonly SceneVariant[]>;
  getLease(sceneId: SceneId): Promise<SceneEditingLease | undefined>;
  initialize(
    input: InitializeSceneDocumentInput
  ): Promise<SceneDocumentHead>;
  acquireOrRenewLease(
    input: AcquireSceneLeaseInput
  ): Promise<AcquireSceneLeaseOutcome>;
  releaseLease(input: ReleaseSceneLeaseInput): Promise<boolean>;
  saveWorkingDocument(
    input: SaveWorkingSceneDocumentInput
  ): Promise<SaveWorkingSceneDocumentOutcome>;
  createManualCheckpoint(
    input: CreateSceneCheckpointInput
  ): Promise<CreateSceneCheckpointOutcome>;
  createNamedVariant(
    input: CreateNamedSceneVariantInput
  ): Promise<CreateNamedSceneVariantOutcome>;
  restoreRevision(
    input: RestoreSceneRevisionInput
  ): Promise<RestoreSceneRevisionOutcome>;
}
