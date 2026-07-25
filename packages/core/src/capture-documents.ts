import {
  validateSceneDocumentV1,
  type SceneDocumentV1
} from "@ghostwriter/editor";
import {
  DomainValidationError,
  type CaptureId,
  type CaptureRevisionId,
  type ProjectId,
  type SceneId
} from "./domain.js";
import type { AccountId } from "./identity.js";

type BrandedString<Name extends string> = string & {
  readonly __brand: Name;
};

export type CaptureContentHash = BrandedString<"CaptureContentHash">;
export type CaptureStatus = "draft" | "ready" | "integrated" | "archived";
export type CaptureSourceModality = "text" | "dictation";

export type CaptureRevisionOrigin = "human" | "agent" | "system";
export type CaptureRevisionReason = "genesis" | "integration";

export type CaptureDocumentHead = Readonly<{
  captureId: CaptureId;
  projectId: ProjectId;
  status: CaptureStatus;
  sourceModality: CaptureSourceModality;
  workingVersion: number;
  document: SceneDocumentV1;
  contentHash: CaptureContentHash;
  genesisRevisionId: CaptureRevisionId;
  authorAccountId: AccountId;
  updatedByAccountId: AccountId;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  integrationRevisionId?: CaptureRevisionId;
  integratedSceneId?: SceneId;
  integratedAt?: string;
  integratedByAccountId?: AccountId;
}>;

export type CaptureSummary = Readonly<{
  captureId: CaptureId;
  projectId: ProjectId;
  status: CaptureStatus;
  sourceModality: CaptureSourceModality;
  workingVersion: number;
  authorAccountId: AccountId;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  integrationRevisionId?: CaptureRevisionId;
  integratedSceneId?: SceneId;
  integratedAt?: string;
  integratedByAccountId?: AccountId;
}>;

export type CaptureRevision = Readonly<{
  id: CaptureRevisionId;
  captureId: CaptureId;
  projectId: ProjectId;
  parentRevisionId?: CaptureRevisionId;
  document: SceneDocumentV1;
  contentHash: CaptureContentHash;
  actorAccountId: AccountId;
  origin: CaptureRevisionOrigin;
  reason: CaptureRevisionReason;
  createdAt: string;
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

export function captureContentHash(value: string): CaptureContentHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "Capture content hash must be a SHA-256 digest."
    );
  }
  return normalized as CaptureContentHash;
}

export function createCaptureDocumentHead(
  input: CaptureDocumentHead
): CaptureDocumentHead {
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : requireText(input.archivedAt, "Capture archive time");
  const integrationRevisionId =
    input.integrationRevisionId === undefined
      ? undefined
      : input.integrationRevisionId;
  const integratedSceneId =
    input.integratedSceneId === undefined ? undefined : input.integratedSceneId;
  const integratedAt =
    input.integratedAt === undefined
      ? undefined
      : requireText(input.integratedAt, "Capture integration time");
  const integratedByAccountId =
    input.integratedByAccountId === undefined
      ? undefined
      : input.integratedByAccountId;
  const integrationFields = [
    integrationRevisionId,
    integratedSceneId,
    integratedAt,
    integratedByAccountId
  ];
  const integrationFieldCount = integrationFields.filter(
    (field) => field !== undefined
  ).length;
  if (input.status === "integrated") {
    if (integrationFieldCount !== 4) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Integrated captures must record complete integration provenance."
      );
    }
  } else if (integrationFieldCount > 0) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only integrated captures may record integration provenance."
    );
  }

  if (input.status === "archived") {
    if (archivedAt === undefined) {
      throw new DomainValidationError(
        "UNKNOWN_REFERENCE",
        "Archived captures must record an archive time."
      );
    }
  } else if (archivedAt !== undefined) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Only archived captures may record an archive time."
    );
  }

  return Object.freeze({
    captureId: input.captureId,
    projectId: input.projectId,
    status: input.status,
    sourceModality: input.sourceModality,
    workingVersion: requirePositiveVersion(
      input.workingVersion,
      "Capture working version"
    ),
    document: validateSceneDocumentV1(input.document),
    contentHash: captureContentHash(input.contentHash),
    genesisRevisionId: input.genesisRevisionId,
    authorAccountId: input.authorAccountId,
    updatedByAccountId: input.updatedByAccountId,
    createdAt: requireText(input.createdAt, "Capture creation time"),
    updatedAt: requireText(input.updatedAt, "Capture update time"),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(integrationRevisionId === undefined
      ? {}
      : { integrationRevisionId }),
    ...(integratedSceneId === undefined ? {} : { integratedSceneId }),
    ...(integratedAt === undefined ? {} : { integratedAt }),
    ...(integratedByAccountId === undefined ? {} : { integratedByAccountId })
  });
}

export function createCaptureRevision(input: CaptureRevision): CaptureRevision {
  const parentRevisionId =
    input.parentRevisionId === undefined ? undefined : input.parentRevisionId;
  return Object.freeze({
    id: input.id,
    captureId: input.captureId,
    projectId: input.projectId,
    ...(parentRevisionId === undefined ? {} : { parentRevisionId }),
    document: validateSceneDocumentV1(input.document),
    contentHash: captureContentHash(input.contentHash),
    actorAccountId: input.actorAccountId,
    origin: input.origin,
    reason: input.reason,
    createdAt: requireText(input.createdAt, "Capture revision creation time")
  });
}

export function captureSummaryFromHead(
  head: CaptureDocumentHead
): CaptureSummary {
  return Object.freeze({
    captureId: head.captureId,
    projectId: head.projectId,
    status: head.status,
    sourceModality: head.sourceModality,
    workingVersion: head.workingVersion,
    authorAccountId: head.authorAccountId,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    ...(head.archivedAt === undefined ? {} : { archivedAt: head.archivedAt }),
    ...(head.integrationRevisionId === undefined
      ? {}
      : { integrationRevisionId: head.integrationRevisionId }),
    ...(head.integratedSceneId === undefined
      ? {}
      : { integratedSceneId: head.integratedSceneId }),
    ...(head.integratedAt === undefined ? {} : { integratedAt: head.integratedAt }),
    ...(head.integratedByAccountId === undefined
      ? {}
      : { integratedByAccountId: head.integratedByAccountId })
  });
}

export function isEligibleCaptureForScenePromotion(
  head: CaptureDocumentHead,
  genesisRevision: CaptureRevision
): boolean {
  if (head.status !== "draft" && head.status !== "ready") {
    return false;
  }
  if (head.workingVersion <= 1) {
    return false;
  }
  if (isUntouchedEmptyGenesisCapture(head, genesisRevision)) {
    return false;
  }
  if (head.contentHash === genesisRevision.contentHash) {
    return false;
  }
  return true;
}

export function isUntouchedEmptyGenesisCapture(
  head: CaptureDocumentHead,
  genesisRevision: CaptureRevision
): boolean {
  return (
    head.workingVersion === 1 &&
    head.contentHash === genesisRevision.contentHash
  );
}

export class CaptureNotFoundError extends Error {
  constructor() {
    super("Capture not found.");
    this.name = "CaptureNotFoundError";
  }
}

export class CaptureVersionConflictError extends Error {
  readonly code = "CAPTURE_VERSION_CONFLICT" as const;

  constructor() {
    super("The capture changed since it was loaded.");
    this.name = "CaptureVersionConflictError";
  }
}

export class InvalidCaptureDocumentError extends Error {
  constructor() {
    super("The capture document is invalid.");
    this.name = "InvalidCaptureDocumentError";
  }
}

export class CaptureIntegratedMutationError extends Error {
  constructor() {
    super("Integrated captures cannot be edited.");
    this.name = "CaptureIntegratedMutationError";
  }
}

export class CaptureArchivedMutationError extends Error {
  constructor() {
    super("Archived captures cannot be edited.");
    this.name = "CaptureArchivedMutationError";
  }
}

export class ProjectArchivedMutationError extends Error {
  constructor() {
    super("Archived projects cannot be changed.");
    this.name = "ProjectArchivedMutationError";
  }
}

export class CaptureContentHashMismatchError extends Error {
  readonly code = "CAPTURE_CONTENT_HASH_MISMATCH" as const;

  constructor() {
    super("The capture content hash does not match.");
    this.name = "CaptureContentHashMismatchError";
  }
}

export class CapturePromotionNotEligibleError extends Error {
  readonly code = "CAPTURE_PROMOTION_NOT_ELIGIBLE" as const;

  constructor() {
    super("The capture cannot be promoted into a scene.");
    this.name = "CapturePromotionNotEligibleError";
  }
}
