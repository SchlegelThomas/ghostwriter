import {
  validateSceneDocumentV1,
  type SceneDocumentComparison,
  type SceneDocumentV1
} from "@ghostwriter/editor";
import {
  DomainValidationError,
  type ProjectId,
  type RevisionId,
  type SceneId,
  type SceneVariantId
} from "./domain.js";
import type { AccountId } from "./identity.js";

type BrandedString<Name extends string> = string & {
  readonly __brand: Name;
};

export type SceneContentHash = BrandedString<"SceneContentHash">;
export type SceneLeaseHolderId = BrandedString<"SceneLeaseHolderId">;
export const SCENE_VARIANT_NAME_MAX_LENGTH = 100;

export type SceneRevisionOrigin = "human" | "agent" | "system";
export type SceneRevisionReason =
  | "genesis"
  | "checkpoint"
  | "idle-checkpoint"
  | "restore"
  | "schema-migration";

export type SceneDocumentHead = Readonly<{
  sceneId: SceneId;
  projectId: ProjectId;
  workingVersion: number;
  document: SceneDocumentV1;
  contentHash: SceneContentHash;
  checkpointRevisionId: RevisionId;
  updatedByAccountId: AccountId;
  createdAt: string;
  updatedAt: string;
}>;

export type SceneRevision = Readonly<{
  id: RevisionId;
  sceneId: SceneId;
  projectId: ProjectId;
  parentRevisionId?: RevisionId;
  document: SceneDocumentV1;
  contentHash: SceneContentHash;
  actorAccountId: AccountId;
  origin: SceneRevisionOrigin;
  reason: SceneRevisionReason;
  createdAt: string;
}>;

export type SceneRevisionMetadata = Readonly<{
  id: RevisionId;
  sceneId: SceneId;
  projectId: ProjectId;
  parentRevisionId?: RevisionId;
  schemaVersion: number;
  contentHash: SceneContentHash;
  actorAccountId: AccountId;
  origin: SceneRevisionOrigin;
  reason: SceneRevisionReason;
  createdAt: string;
}>;

export type SceneVariant = Readonly<{
  id: SceneVariantId;
  sceneId: SceneId;
  projectId: ProjectId;
  revisionId: RevisionId;
  creatorAccountId: AccountId;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SceneEditingLease = Readonly<{
  sceneId: SceneId;
  projectId: ProjectId;
  holderId: SceneLeaseHolderId;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
}>;

export type SceneWorkspace = Readonly<{
  head: SceneDocumentHead;
  lease?: SceneEditingLease;
}>;

export type SceneRevisionComparison = Readonly<{
  beforeRevision: SceneRevisionMetadata;
  afterRevision: SceneRevisionMetadata;
  comparison: SceneDocumentComparison;
}>;

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  return normalized;
}

function requirePositiveVersion(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      `${field} must be a positive integer.`
    );
  }
  return value;
}

export function sceneContentHash(value: string): SceneContentHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Scene content hash must be a SHA-256 digest."
    );
  }
  return normalized as SceneContentHash;
}

export function sceneLeaseHolderId(value: string): SceneLeaseHolderId {
  return requireText(value, "Scene lease holder ID") as SceneLeaseHolderId;
}

export function sceneVariantName(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > SCENE_VARIANT_NAME_MAX_LENGTH
  ) {
    throw new InvalidSceneVariantNameError();
  }
  return normalized;
}

export function createSceneDocumentHead(
  input: SceneDocumentHead
): SceneDocumentHead {
  return Object.freeze({
    sceneId: input.sceneId,
    projectId: input.projectId,
    workingVersion: requirePositiveVersion(
      input.workingVersion,
      "Scene working version"
    ),
    document: validateSceneDocumentV1(input.document),
    contentHash: sceneContentHash(input.contentHash),
    checkpointRevisionId: input.checkpointRevisionId,
    updatedByAccountId: input.updatedByAccountId,
    createdAt: requireText(input.createdAt, "Scene document creation time"),
    updatedAt: requireText(input.updatedAt, "Scene document update time")
  });
}

export function createSceneRevision(input: SceneRevision): SceneRevision {
  const parentRevisionId =
    input.parentRevisionId === undefined ? undefined : input.parentRevisionId;
  return Object.freeze({
    id: input.id,
    sceneId: input.sceneId,
    projectId: input.projectId,
    ...(parentRevisionId === undefined ? {} : { parentRevisionId }),
    document: validateSceneDocumentV1(input.document),
    contentHash: sceneContentHash(input.contentHash),
    actorAccountId: input.actorAccountId,
    origin: input.origin,
    reason: input.reason,
    createdAt: requireText(input.createdAt, "Scene revision creation time")
  });
}

export function sceneRevisionMetadata(
  revision: SceneRevision
): SceneRevisionMetadata {
  return Object.freeze({
    id: revision.id,
    sceneId: revision.sceneId,
    projectId: revision.projectId,
    ...(revision.parentRevisionId === undefined
      ? {}
      : { parentRevisionId: revision.parentRevisionId }),
    schemaVersion: revision.document.schemaVersion,
    contentHash: revision.contentHash,
    actorAccountId: revision.actorAccountId,
    origin: revision.origin,
    reason: revision.reason,
    createdAt: revision.createdAt
  });
}

export function createSceneVariant(input: SceneVariant): SceneVariant {
  return Object.freeze({
    id: input.id,
    sceneId: input.sceneId,
    projectId: input.projectId,
    revisionId: input.revisionId,
    creatorAccountId: input.creatorAccountId,
    name: sceneVariantName(input.name),
    createdAt: requireText(input.createdAt, "Scene variant creation time"),
    updatedAt: requireText(input.updatedAt, "Scene variant update time")
  });
}

export function createSceneEditingLease(
  input: SceneEditingLease
): SceneEditingLease {
  return Object.freeze({
    sceneId: input.sceneId,
    projectId: input.projectId,
    holderId: sceneLeaseHolderId(input.holderId),
    acquiredAt: requireText(input.acquiredAt, "Scene lease acquisition time"),
    renewedAt: requireText(input.renewedAt, "Scene lease renewal time"),
    expiresAt: requireText(input.expiresAt, "Scene lease expiry time")
  });
}

export class SceneNotFoundError extends Error {
  constructor() {
    super("Scene not found.");
    this.name = "SceneNotFoundError";
  }
}

export class SceneWorkingVersionConflictError extends Error {
  constructor() {
    super("The scene changed since it was loaded.");
    this.name = "SceneWorkingVersionConflictError";
  }
}

export class SceneLeaseConflictError extends Error {
  constructor() {
    super("The scene is being edited in another session.");
    this.name = "SceneLeaseConflictError";
  }
}

export class SceneLeaseExpiredError extends Error {
  constructor() {
    super("The scene editing lease expired.");
    this.name = "SceneLeaseExpiredError";
  }
}

export class InvalidSceneDocumentError extends Error {
  constructor() {
    super("The scene document is invalid.");
    this.name = "InvalidSceneDocumentError";
  }
}

export class SceneRevisionNotFoundError extends Error {
  constructor() {
    super("Scene revision not found.");
    this.name = "SceneRevisionNotFoundError";
  }
}

export class SceneVariantNameConflictError extends Error {
  constructor() {
    super("A variant with this name already exists for the scene.");
    this.name = "SceneVariantNameConflictError";
  }
}

export class InvalidSceneVariantNameError extends Error {
  constructor() {
    super(
      `Variant name must contain 1 to ${SCENE_VARIANT_NAME_MAX_LENGTH} characters.`
    );
    this.name = "InvalidSceneVariantNameError";
  }
}
