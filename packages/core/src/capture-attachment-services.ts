import { attachmentId as toAttachmentId, type AttachmentId, type CaptureId, type ProjectId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { CaptureDocumentRepository } from "./capture-document-repository.js";
import {
  CaptureNotFoundError,
  ProjectArchivedMutationError,
  type CaptureStatus
} from "./capture-documents.js";
import type { CaptureAttachmentRepository } from "./capture-attachment-repository.js";
import type { CaptureObjectStoragePort, PresignedObjectUrl } from "./capture-object-storage.js";
import type { Clock, IdGenerator, ProjectRepository } from "./project-repository.js";
import {
  CAPTURE_ATTACHMENT_DOWNLOAD_URL_TTL_MS,
  CAPTURE_ATTACHMENT_PENDING_EXPIRY_MS,
  CAPTURE_ATTACHMENT_UPLOAD_URL_TTL_MS,
  CaptureAttachmentNotFoundError,
  CaptureAttachmentNotEditableError,
  CaptureAttachmentPolicyError,
  CaptureAttachmentStorageError,
  addIsoDurationMs,
  buildCaptureAttachmentObjectKey,
  captureAttachmentSummaryFromRecord,
  createCaptureAttachmentDisplayFilename,
  createCaptureAttachmentRecord,
  isAllowedCaptureAttachmentDeclaredMime,
  isIsoBefore,
  maxByteSizeForCaptureAttachmentMime,
  sha256Digest,
  validateDeclaredCaptureAttachment,
  type CaptureAttachmentAllowedMime,
  type CaptureAttachmentRefusalCode,
  type CaptureAttachmentSummary
} from "./capture-attachments.js";

export type InitCaptureAttachmentUploadInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureId;
  displayFilename: string;
  declaredContentType: string;
  declaredByteSize: number;
  clientSha256: string;
}>;

export type InitCaptureAttachmentUploadResult = Readonly<{
  attachment: CaptureAttachmentSummary;
  upload: PresignedObjectUrl;
}>;

export type FinalizeCaptureAttachmentUploadInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
}>;

export type CaptureAttachmentDownloadInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
}>;

export type DeleteCaptureAttachmentServiceInput = Readonly<{
  accountId: AccountId;
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
}>;

export type CaptureAttachmentServices = Readonly<{
  initAttachmentUpload(
    input: InitCaptureAttachmentUploadInput
  ): Promise<InitCaptureAttachmentUploadResult>;
  finalizeAttachmentUpload(
    input: FinalizeCaptureAttachmentUploadInput
  ): Promise<CaptureAttachmentSummary>;
  listAttachments(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    captureId: CaptureId;
  }>): Promise<readonly CaptureAttachmentSummary[]>;
  getAttachmentDownloadUrl(
    input: CaptureAttachmentDownloadInput
  ): Promise<PresignedObjectUrl>;
  deleteAttachment(input: DeleteCaptureAttachmentServiceInput): Promise<CaptureAttachmentSummary>;
  cleanupExpiredPending(): Promise<number>;
}>;

export type CaptureAttachmentServiceDependencies = Readonly<{
  projects: ProjectRepository;
  captureDocuments: CaptureDocumentRepository;
  attachments: CaptureAttachmentRepository;
  objectStorage: CaptureObjectStoragePort;
  ids: IdGenerator;
  clock: Clock;
}>;

function isCaptureEditableForAttachmentUpload(status: CaptureStatus): boolean {
  return status === "draft" || status === "ready";
}

async function requireOwnedProjectRead(
  dependencies: CaptureAttachmentServiceDependencies,
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
      throw new CaptureAttachmentNotFoundError();
    }
    throw error;
  }
  const project = await dependencies.projects.getProject(projectId);
  if (project === undefined) {
    throw new CaptureAttachmentNotFoundError();
  }
}

async function requireOwnedActiveProjectMutation(
  dependencies: CaptureAttachmentServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId
): Promise<void> {
  await requireOwnedProjectRead(dependencies, accountId, projectId);
  const project = await dependencies.projects.getProject(projectId);
  if (project?.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
}

async function requireOwnedCaptureInProject(
  dependencies: CaptureAttachmentServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  captureId: CaptureId
): Promise<void> {
  await requireOwnedProjectRead(dependencies, accountId, projectId);
  const head = await dependencies.captureDocuments.get(captureId);
  if (head === undefined || head.projectId !== projectId) {
    throw new CaptureNotFoundError();
  }
}

async function requireOwnedAttachment(
  dependencies: CaptureAttachmentServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  captureId: CaptureId,
  requestedAttachmentId: AttachmentId
) {
  await requireOwnedCaptureInProject(dependencies, accountId, projectId, captureId);
  const record = await dependencies.attachments.get(requestedAttachmentId);
  if (
    record === undefined ||
    record.projectId !== projectId ||
    record.captureId !== captureId
  ) {
    throw new CaptureAttachmentNotFoundError();
  }
  return record;
}

async function refusePendingAttachment(
  dependencies: CaptureAttachmentServiceDependencies,
  input: Readonly<{
    projectId: ProjectId;
    captureId: CaptureId;
    attachmentId: AttachmentId;
    refusalCode: CaptureAttachmentRefusalCode;
    objectKey: string;
    now: string;
  }>
): Promise<CaptureAttachmentSummary> {
  try {
    await dependencies.objectStorage.deleteObject(input.objectKey);
  } catch {
    throw new CaptureAttachmentStorageError();
  }
  const outcome = await dependencies.attachments.refuse({
    projectId: input.projectId,
    captureId: input.captureId,
    attachmentId: input.attachmentId,
    refusalCode: input.refusalCode,
    now: input.now
  });
  if (!outcome.ok) {
    throw new CaptureAttachmentNotFoundError();
  }
  return captureAttachmentSummaryFromRecord(outcome.record);
}

function mapReserveFailure(
  reason: "attachment-count-exceeded" | "project-quota-exceeded"
): never {
  if (reason === "attachment-count-exceeded") {
    throw new CaptureAttachmentPolicyError("attachment-count-exceeded");
  }
  throw new CaptureAttachmentPolicyError("project-quota-exceeded");
}

function mapInspectionToRefusal(
  inspection: Readonly<{ supported: boolean }> | undefined,
  record: Readonly<{
    declaredContentType: CaptureAttachmentAllowedMime;
    declaredByteSize: number;
    clientSha256: ReturnType<typeof sha256Digest>;
  }>,
  inspectionValues?: Readonly<{
    actualByteSize: number;
    serverSha256: ReturnType<typeof sha256Digest>;
    detectedContentType: string;
  }>
): CaptureAttachmentRefusalCode {
  if (inspection === undefined || inspectionValues === undefined) {
    return "object-missing";
  }
  if (!inspection.supported) {
    return "unsupported-type";
  }
  if (inspectionValues.detectedContentType !== record.declaredContentType) {
    return "type-mismatch";
  }
  if (inspectionValues.actualByteSize !== record.declaredByteSize) {
    return "size-mismatch";
  }
  if (inspectionValues.serverSha256 !== record.clientSha256) {
    return "checksum-mismatch";
  }
  const limit = maxByteSizeForCaptureAttachmentMime(record.declaredContentType);
  if (inspectionValues.actualByteSize > limit) {
    return "declared-size-exceeded";
  }
  return "inspection-failed";
}

export function createCaptureAttachmentServices(
  dependencies: CaptureAttachmentServiceDependencies
): CaptureAttachmentServices {
  return Object.freeze({
    async initAttachmentUpload(input) {
      await requireOwnedActiveProjectMutation(
        dependencies,
        input.accountId,
        input.projectId
      );
      const capture = await dependencies.captureDocuments.get(input.captureId);
      if (capture === undefined || capture.projectId !== input.projectId) {
        throw new CaptureNotFoundError();
      }
      if (!isCaptureEditableForAttachmentUpload(capture.status)) {
        throw new CaptureAttachmentPolicyError("capture-not-editable");
      }

      const declared = validateDeclaredCaptureAttachment({
        declaredContentType: input.declaredContentType,
        declaredByteSize: input.declaredByteSize
      });
      if (!declared.ok) {
        throw new CaptureAttachmentPolicyError(declared.code);
      }

      let clientSha256: ReturnType<typeof sha256Digest>;
      try {
        clientSha256 = sha256Digest(input.clientSha256);
      } catch {
        throw new CaptureAttachmentPolicyError("checksum-invalid");
      }

      const displayFilename = createCaptureAttachmentDisplayFilename(input.displayFilename);
      const now = dependencies.clock.now();
      const attachmentIdValue = toAttachmentId(dependencies.ids.create("attachment"));
      const objectKey = buildCaptureAttachmentObjectKey({
        projectId: input.projectId,
        captureId: input.captureId,
        attachmentId: attachmentIdValue
      });
      const pendingRecord = createCaptureAttachmentRecord({
        attachmentId: attachmentIdValue,
        captureId: input.captureId,
        projectId: input.projectId,
        state: "pending",
        displayFilename,
        declaredContentType: declared.contentType,
        declaredByteSize: input.declaredByteSize,
        clientSha256,
        objectKey,
        pendingExpiresAt: addIsoDurationMs(now, CAPTURE_ATTACHMENT_PENDING_EXPIRY_MS),
        createdAt: now,
        updatedAt: now
      });

      const reserveOutcome = await dependencies.attachments.reserve({
        record: pendingRecord
      });
      if (!reserveOutcome.ok) {
        mapReserveFailure(reserveOutcome.reason);
      }

      const uploadExpiresAt = addIsoDurationMs(now, CAPTURE_ATTACHMENT_UPLOAD_URL_TTL_MS);
      try {
        const upload = await dependencies.objectStorage.presignPut({
          objectKey,
          contentType: declared.contentType,
          expiresAt: uploadExpiresAt
        });
        return Object.freeze({
          attachment: captureAttachmentSummaryFromRecord(reserveOutcome.record),
          upload
        });
      } catch {
        await dependencies.attachments.removePending({
          projectId: input.projectId,
          captureId: input.captureId,
          attachmentId: attachmentIdValue
        });
        throw new CaptureAttachmentStorageError();
      }
    },

    async finalizeAttachmentUpload(input) {
      await requireOwnedActiveProjectMutation(
        dependencies,
        input.accountId,
        input.projectId
      );
      const capture = await dependencies.captureDocuments.get(input.captureId);
      if (capture === undefined || capture.projectId !== input.projectId) {
        throw new CaptureNotFoundError();
      }
      if (!isCaptureEditableForAttachmentUpload(capture.status)) {
        throw new CaptureAttachmentPolicyError("capture-not-editable");
      }

      const record = await requireOwnedAttachment(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId,
        input.attachmentId
      );
      if (record.state !== "pending") {
        throw new CaptureAttachmentNotEditableError();
      }
      const now = dependencies.clock.now();
      if (
        record.pendingExpiresAt !== undefined &&
        isIsoBefore(record.pendingExpiresAt, now)
      ) {
        throw new CaptureAttachmentPolicyError("attachment-expired");
      }

      let inspection;
      try {
        inspection = await dependencies.objectStorage.inspectObject(record.objectKey);
      } catch {
        throw new CaptureAttachmentStorageError();
      }

      if (inspection === undefined) {
        return refusePendingAttachment(dependencies, {
          projectId: input.projectId,
          captureId: input.captureId,
          attachmentId: input.attachmentId,
          refusalCode: "object-missing",
          objectKey: record.objectKey,
          now
        });
      }

      const readyType = isAllowedCaptureAttachmentDeclaredMime(inspection.detectedContentType)
        ? inspection.detectedContentType
        : undefined;

      const matches =
        inspection.supported &&
        readyType === record.declaredContentType &&
        inspection.actualByteSize === record.declaredByteSize &&
        inspection.serverSha256 === record.clientSha256 &&
        inspection.actualByteSize <= maxByteSizeForCaptureAttachmentMime(record.declaredContentType);

      if (!matches) {
        const refusalCode = mapInspectionToRefusal(inspection, record, {
          actualByteSize: inspection.actualByteSize,
          serverSha256: inspection.serverSha256,
          detectedContentType: inspection.detectedContentType
        });
        return refusePendingAttachment(dependencies, {
          projectId: input.projectId,
          captureId: input.captureId,
          attachmentId: input.attachmentId,
          refusalCode,
          objectKey: record.objectKey,
          now
        });
      }

      const outcome = await dependencies.attachments.finalize({
        projectId: input.projectId,
        captureId: input.captureId,
        attachmentId: input.attachmentId,
        readyContentType: record.declaredContentType,
        actualByteSize: inspection.actualByteSize,
        serverSha256: inspection.serverSha256,
        now
      });
      if (!outcome.ok) {
        if (outcome.reason === "expired") {
          throw new CaptureAttachmentPolicyError("attachment-expired");
        }
        throw new CaptureAttachmentNotFoundError();
      }
      return captureAttachmentSummaryFromRecord(outcome.record);
    },

    async listAttachments(input) {
      await requireOwnedCaptureInProject(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId
      );
      return dependencies.attachments.listByCapture(input.projectId, input.captureId);
    },

    async getAttachmentDownloadUrl(input) {
      const record = await requireOwnedAttachment(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId,
        input.attachmentId
      );
      if (record.state !== "ready") {
        throw new CaptureAttachmentPolicyError("attachment-not-ready");
      }
      const now = dependencies.clock.now();
      const expiresAt = addIsoDurationMs(now, CAPTURE_ATTACHMENT_DOWNLOAD_URL_TTL_MS);
      try {
        return await dependencies.objectStorage.presignGet({
          objectKey: record.objectKey,
          expiresAt
        });
      } catch {
        throw new CaptureAttachmentStorageError();
      }
    },

    async deleteAttachment(input) {
      await requireOwnedProjectRead(dependencies, input.accountId, input.projectId);
      const record = await requireOwnedAttachment(
        dependencies,
        input.accountId,
        input.projectId,
        input.captureId,
        input.attachmentId
      );
      if (record.state === "deleted") {
        return captureAttachmentSummaryFromRecord(record);
      }
      const now = dependencies.clock.now();
      try {
        await dependencies.objectStorage.deleteObject(record.objectKey);
      } catch {
        throw new CaptureAttachmentStorageError();
      }
      const outcome = await dependencies.attachments.delete({
        projectId: input.projectId,
        captureId: input.captureId,
        attachmentId: input.attachmentId,
        now
      });
      if (!outcome.ok) {
        if (outcome.reason === "already-deleted") {
          const current = await dependencies.attachments.get(input.attachmentId);
          if (current !== undefined) {
            return captureAttachmentSummaryFromRecord(current);
          }
        }
        throw new CaptureAttachmentNotFoundError();
      }
      return captureAttachmentSummaryFromRecord(outcome.record);
    },

    async cleanupExpiredPending() {
      const now = dependencies.clock.now();
      const expired = await dependencies.attachments.listExpiredPending(now);
      let cleaned = 0;
      for (const record of expired) {
        try {
          await dependencies.objectStorage.deleteObject(record.objectKey);
        } catch {
          continue;
        }
        const deleteOutcome = await dependencies.attachments.delete({
          projectId: record.projectId,
          captureId: record.captureId,
          attachmentId: record.attachmentId,
          now
        });
        if (deleteOutcome.ok) {
          cleaned += 1;
        }
      }
      return cleaned;
    }
  });
}
