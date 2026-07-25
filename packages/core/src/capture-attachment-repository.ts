import type { AttachmentId, CaptureId, ProjectId } from "./domain.js";
import type {
  CaptureAttachmentRecord,
  CaptureAttachmentRefusalCode,
  CaptureAttachmentSummary,
  Sha256Digest
} from "./capture-attachments.js";

export type ReserveCaptureAttachmentInput = Readonly<{
  record: CaptureAttachmentRecord;
}>;

export type ReserveCaptureAttachmentOutcome =
  | Readonly<{ ok: true; record: CaptureAttachmentRecord }>
  | Readonly<{
      ok: false;
      reason: "attachment-count-exceeded" | "project-quota-exceeded";
    }>;

export type FinalizeCaptureAttachmentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
  readyContentType: CaptureAttachmentRecord["declaredContentType"];
  actualByteSize: number;
  serverSha256: Sha256Digest;
  now: string;
}>;

export type FinalizeCaptureAttachmentOutcome =
  | Readonly<{ ok: true; record: CaptureAttachmentRecord }>
  | Readonly<{
      ok: false;
      reason: "not-found" | "not-pending" | "expired";
    }>;

export type RefuseCaptureAttachmentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
  refusalCode: CaptureAttachmentRefusalCode;
  now: string;
}>;

export type RefuseCaptureAttachmentOutcome =
  | Readonly<{ ok: true; record: CaptureAttachmentRecord }>
  | Readonly<{ ok: false; reason: "not-found" | "not-pending" }>;

export type DeleteCaptureAttachmentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
  now: string;
}>;

export type DeleteCaptureAttachmentOutcome =
  | Readonly<{ ok: true; record: CaptureAttachmentRecord }>
  | Readonly<{ ok: false; reason: "not-found" | "already-deleted" }>;

export type RemovePendingCaptureAttachmentInput = Readonly<{
  projectId: ProjectId;
  captureId: CaptureId;
  attachmentId: AttachmentId;
}>;

export interface CaptureAttachmentRepository {
  get(attachmentId: AttachmentId): Promise<CaptureAttachmentRecord | undefined>;
  listByCapture(
    projectId: ProjectId,
    captureId: CaptureId
  ): Promise<readonly CaptureAttachmentSummary[]>;
  reserve(input: ReserveCaptureAttachmentInput): Promise<ReserveCaptureAttachmentOutcome>;
  finalize(input: FinalizeCaptureAttachmentInput): Promise<FinalizeCaptureAttachmentOutcome>;
  refuse(input: RefuseCaptureAttachmentInput): Promise<RefuseCaptureAttachmentOutcome>;
  delete(input: DeleteCaptureAttachmentInput): Promise<DeleteCaptureAttachmentOutcome>;
  removePending(input: RemovePendingCaptureAttachmentInput): Promise<void>;
  listExpiredPending(now: string): Promise<readonly CaptureAttachmentRecord[]>;
}
