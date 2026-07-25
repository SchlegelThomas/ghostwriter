import {
  CaptureAttachmentNotEditableError,
  CaptureAttachmentNotFoundError,
  CaptureAttachmentPolicyError,
  CaptureAttachmentStorageError,
  CaptureNotFoundError,
  type CaptureAttachmentPolicyCode,
  type CaptureAttachmentSummary,
  type PresignedObjectUrl
} from "@ghostwriter/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function captureAttachmentSummaryResponse(summary: CaptureAttachmentSummary) {
  return {
    attachmentId: summary.attachmentId,
    captureId: summary.captureId,
    projectId: summary.projectId,
    state: summary.state,
    displayFilename: summary.displayFilename,
    declaredContentType: summary.declaredContentType,
    declaredByteSize: summary.declaredByteSize,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(summary.readyContentType === undefined
      ? {}
      : { readyContentType: summary.readyContentType }),
    ...(summary.actualByteSize === undefined
      ? {}
      : { actualByteSize: summary.actualByteSize }),
    ...(summary.pendingExpiresAt === undefined
      ? {}
      : { pendingExpiresAt: summary.pendingExpiresAt }),
    ...(summary.refusalCode === undefined ? {} : { refusalCode: summary.refusalCode }),
    ...(summary.readyAt === undefined ? {} : { readyAt: summary.readyAt }),
    ...(summary.deletedAt === undefined ? {} : { deletedAt: summary.deletedAt })
  };
}

export function captureAttachmentUploadResponse(input: Readonly<{
  attachment: CaptureAttachmentSummary;
  upload: PresignedObjectUrl;
  requiredContentType: string;
}>) {
  return {
    attachment: captureAttachmentSummaryResponse(input.attachment),
    upload: {
      url: input.upload.url,
      expiresAt: input.upload.expiresAt
    },
    uploadHeaders: Object.freeze({
      "Content-Type": input.requiredContentType
    })
  };
}

export function captureAttachmentDownloadResponse(download: PresignedObjectUrl) {
  return {
    download: {
      url: download.url,
      expiresAt: download.expiresAt
    }
  };
}

function policyErrorStatusAndCode(
  code: CaptureAttachmentPolicyCode
): Readonly<{ status: ContentfulStatusCode; apiCode: string; message: string }> {
  switch (code) {
    case "unsupported-content-type":
      return {
        status: 415,
        apiCode: "ATTACHMENT_TYPE_REFUSED",
        message: "This attachment type is not supported."
      };
    case "declared-size-exceeded":
      return {
        status: 413,
        apiCode: "ATTACHMENT_SIZE_EXCEEDED",
        message: "This attachment exceeds the allowed size."
      };
    case "attachment-count-exceeded":
    case "project-quota-exceeded":
      return {
        status: 409,
        apiCode: "ATTACHMENT_QUOTA_EXCEEDED",
        message: "This project has reached its attachment limit."
      };
    case "checksum-invalid":
      return {
        status: 400,
        apiCode: "INVALID_REQUEST",
        message: "The attachment request was invalid."
      };
    case "capture-not-editable":
      return {
        status: 409,
        apiCode: "CAPTURE_NOT_EDITABLE",
        message: "This capture cannot be edited."
      };
    case "attachment-expired":
      return {
        status: 409,
        apiCode: "ATTACHMENT_EXPIRED",
        message: "This attachment upload expired."
      };
    case "attachment-not-ready":
      return {
        status: 409,
        apiCode: "ATTACHMENT_NOT_READY",
        message: "This attachment is not ready yet."
      };
    case "object-missing":
      return {
        status: 409,
        apiCode: "ATTACHMENT_OBJECT_MISSING",
        message: "This attachment upload could not be completed."
      };
    case "inspection-failed":
      return {
        status: 409,
        apiCode: "ATTACHMENT_INSPECTION_FAILED",
        message: "This attachment upload could not be completed."
      };
    case "type-mismatch":
      return {
        status: 409,
        apiCode: "ATTACHMENT_TYPE_MISMATCH",
        message: "This attachment upload could not be completed."
      };
    case "size-mismatch":
      return {
        status: 409,
        apiCode: "ATTACHMENT_SIZE_MISMATCH",
        message: "This attachment upload could not be completed."
      };
    case "checksum-mismatch":
      return {
        status: 409,
        apiCode: "ATTACHMENT_CHECKSUM_MISMATCH",
        message: "This attachment upload could not be completed."
      };
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export function captureAttachmentNotFoundBody() {
  return Object.freeze({
    error: "Capture attachment was not found.",
    code: "ATTACHMENT_NOT_FOUND" as const
  });
}

export function captureAttachmentErrorStatusAndBody(error: unknown):
  | Readonly<{
      status: ContentfulStatusCode;
      body: Readonly<{ error: string; code: string }>;
    }>
  | undefined {
  if (error instanceof CaptureNotFoundError || error instanceof CaptureAttachmentNotFoundError) {
    return { status: 404, body: captureAttachmentNotFoundBody() };
  }
  if (error instanceof CaptureAttachmentNotEditableError) {
    return {
      status: 409,
      body: {
        error: "Capture attachment cannot be changed in the current state.",
        code: "ATTACHMENT_NOT_EDITABLE"
      }
    };
  }
  if (error instanceof CaptureAttachmentStorageError) {
    return {
      status: 503,
      body: {
        error: "Attachment storage is unavailable.",
        code: "ATTACHMENT_STORAGE_UNAVAILABLE"
      }
    };
  }
  if (error instanceof CaptureAttachmentPolicyError) {
    const mapped = policyErrorStatusAndCode(error.code);
    return {
      status: mapped.status,
      body: { error: mapped.message, code: mapped.apiCode }
    };
  }
  return undefined;
}
