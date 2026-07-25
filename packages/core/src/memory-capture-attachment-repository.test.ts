import { describe, expect, it } from "vitest";
import { createMemoryCaptureAttachmentRepository } from "./memory-capture-attachment-repository.js";
import {
  CAPTURE_ATTACHMENT_MAX_PER_CAPTURE,
  CaptureAttachmentStorageError,
  createCaptureAttachmentRecord,
  sha256Digest
} from "./capture-attachments.js";
import { attachmentId, captureId, projectId } from "./domain.js";

const NOW = "2026-07-24T12:00:00.000Z";
const PROJECT = projectId("project-quota");
const CAPTURE = captureId("capture-quota");
const SHARED_OBJECT_KEY = "projects/shared/object-key";

function pendingRecord(input: Readonly<{
  attachmentId: string;
  declaredByteSize?: number;
  objectKey?: string;
}>) {
  return createCaptureAttachmentRecord({
    attachmentId: attachmentId(input.attachmentId),
    captureId: CAPTURE,
    projectId: PROJECT,
    state: "pending",
    displayFilename: `${input.attachmentId}.txt`,
    declaredContentType: "text/plain",
    declaredByteSize: input.declaredByteSize ?? 1,
    clientSha256: sha256Digest("0".repeat(64)),
    objectKey:
      input.objectKey ??
      `projects/${PROJECT}/captures/${CAPTURE}/attachments/${input.attachmentId}`,
    pendingExpiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW
  });
}

describe("memory capture attachment repository", () => {
  it("serializes concurrent reservations so capture count limits hold", async () => {
    const repository = createMemoryCaptureAttachmentRepository();
    const attempts = Array.from({ length: CAPTURE_ATTACHMENT_MAX_PER_CAPTURE + 5 }, (_, index) =>
      repository.reserve({
        record: pendingRecord({ attachmentId: `att-${index}` })
      })
    );
    const outcomes = await Promise.all(attempts);
    const successes = outcomes.filter((outcome) => outcome.ok);
    expect(successes).toHaveLength(CAPTURE_ATTACHMENT_MAX_PER_CAPTURE);
  });

  it("returns the stored record for identical reserve retries and refuses conflicts", async () => {
    const repository = createMemoryCaptureAttachmentRepository();
    const record = pendingRecord({ attachmentId: "att-dup-id" });
    const first = await repository.reserve({ record });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("Expected first reserve to succeed.");
    }

    const identical = await repository.reserve({ record });
    expect(identical).toEqual({ ok: true, record: first.record });

    const conflicting = pendingRecord({
      attachmentId: "att-dup-id",
      declaredByteSize: 2048
    });
    await expect(repository.reserve({ record: conflicting })).rejects.toBeInstanceOf(
      CaptureAttachmentStorageError
    );
  });

  it("refuses duplicate object keys across different attachment IDs", async () => {
    const repository = createMemoryCaptureAttachmentRepository();
    await repository.reserve({
      record: pendingRecord({
        attachmentId: "att-key-a",
        objectKey: SHARED_OBJECT_KEY
      })
    });

    await expect(
      repository.reserve({
        record: pendingRecord({
          attachmentId: "att-key-b",
          objectKey: SHARED_OBJECT_KEY
        })
      })
    ).rejects.toBeInstanceOf(CaptureAttachmentStorageError);
  });
});
