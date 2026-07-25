import { type AttachmentId, type CaptureId, type ProjectId } from "./domain.js";
import type {
  CaptureAttachmentRepository,
  DeleteCaptureAttachmentInput,
  DeleteCaptureAttachmentOutcome,
  FinalizeCaptureAttachmentInput,
  FinalizeCaptureAttachmentOutcome,
  RefuseCaptureAttachmentInput,
  RefuseCaptureAttachmentOutcome,
  RemovePendingCaptureAttachmentInput,
  ReserveCaptureAttachmentInput,
  ReserveCaptureAttachmentOutcome
} from "./capture-attachment-repository.js";
import {
  CAPTURE_ATTACHMENT_MAX_PER_CAPTURE,
  CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES,
  CaptureAttachmentStorageError,
  attachmentBytesCountTowardQuota,
  attachmentCountsTowardQuota,
  captureAttachmentSummaryFromRecord,
  createCaptureAttachmentRecord,
  isIsoBefore,
  type CaptureAttachmentRecord
} from "./capture-attachments.js";
import {
  MEMORY_TRANSACTION_STATE,
  type MemoryTransactionalRepository
} from "./memory-transaction.js";

type MemoryCaptureAttachmentState = {
  records: Map<string, CaptureAttachmentRecord>;
};

function cloneMemoryCaptureAttachmentState(
  state: MemoryCaptureAttachmentState
): MemoryCaptureAttachmentState {
  return {
    records: new Map(
      [...state.records.entries()].map(([id, record]) => [
        id,
        createCaptureAttachmentRecord(record)
      ])
    )
  };
}

function matchesScope(
  record: CaptureAttachmentRecord,
  projectId: ProjectId,
  captureId: CaptureId,
  attachmentId: AttachmentId
): boolean {
  return (
    record.attachmentId === attachmentId &&
    record.captureId === captureId &&
    record.projectId === projectId
  );
}

function countActiveForCapture(
  state: MemoryCaptureAttachmentState,
  projectId: ProjectId,
  captureId: CaptureId
): number {
  let count = 0;
  for (const record of state.records.values()) {
    if (record.projectId !== projectId || record.captureId !== captureId) continue;
    if (attachmentCountsTowardQuota(record.state)) {
      count += 1;
    }
  }
  return count;
}

function sumActiveBytesForProject(
  state: MemoryCaptureAttachmentState,
  projectId: ProjectId
): number {
  let total = 0;
  for (const record of state.records.values()) {
    if (record.projectId !== projectId) continue;
    total += attachmentBytesCountTowardQuota(record);
  }
  return total;
}

function recordsEquivalent(
  left: CaptureAttachmentRecord,
  right: CaptureAttachmentRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findConflictingObjectKey(
  state: MemoryCaptureAttachmentState,
  record: CaptureAttachmentRecord
): CaptureAttachmentRecord | undefined {
  for (const existing of state.records.values()) {
    if (existing.objectKey !== record.objectKey) continue;
    if (existing.attachmentId === record.attachmentId) continue;
    return existing;
  }
  return undefined;
}

export function createMemoryCaptureAttachmentRepository(): CaptureAttachmentRepository {
  let state: MemoryCaptureAttachmentState = {
    records: new Map()
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

  const repository: CaptureAttachmentRepository & MemoryTransactionalRepository = {
    async get(attachmentId: AttachmentId): Promise<CaptureAttachmentRecord | undefined> {
      const record = state.records.get(attachmentId);
      return record === undefined ? undefined : createCaptureAttachmentRecord(record);
    },
    async listByCapture(projectId: ProjectId, captureId: CaptureId) {
      const summaries = [];
      for (const record of state.records.values()) {
        if (record.projectId !== projectId || record.captureId !== captureId) continue;
        summaries.push(captureAttachmentSummaryFromRecord(record));
      }
      return summaries.sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.attachmentId.localeCompare(left.attachmentId)
      );
    },
    reserve(input: ReserveCaptureAttachmentInput): Promise<ReserveCaptureAttachmentOutcome> {
      return serializeWrite(() => {
        const record = createCaptureAttachmentRecord(input.record);
        if (record.state !== "pending") {
          throw new Error("Attachment reservation must start in the pending state.");
        }
        const existing = state.records.get(record.attachmentId);
        if (existing !== undefined) {
          const stored = createCaptureAttachmentRecord(existing);
          if (recordsEquivalent(stored, record)) {
            return { ok: true, record: stored };
          }
          throw new CaptureAttachmentStorageError();
        }
        if (findConflictingObjectKey(state, record) !== undefined) {
          throw new CaptureAttachmentStorageError();
        }
        const captureCount = countActiveForCapture(
          state,
          record.projectId,
          record.captureId
        );
        if (captureCount >= CAPTURE_ATTACHMENT_MAX_PER_CAPTURE) {
          return { ok: false, reason: "attachment-count-exceeded" };
        }
        const projectBytes = sumActiveBytesForProject(state, record.projectId);
        if (
          projectBytes + attachmentBytesCountTowardQuota(record) >
          CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES
        ) {
          return { ok: false, reason: "project-quota-exceeded" };
        }
        state.records.set(record.attachmentId, record);
        return { ok: true, record: createCaptureAttachmentRecord(record) };
      });
    },
    finalize(
      input: FinalizeCaptureAttachmentInput
    ): Promise<FinalizeCaptureAttachmentOutcome> {
      return serializeWrite(() => {
        const current = state.records.get(input.attachmentId);
        if (
          current === undefined ||
          !matchesScope(current, input.projectId, input.captureId, input.attachmentId)
        ) {
          return { ok: false, reason: "not-found" };
        }
        if (current.state !== "pending") {
          return { ok: false, reason: "not-pending" };
        }
        if (
          current.pendingExpiresAt !== undefined &&
          isIsoBefore(current.pendingExpiresAt, input.now)
        ) {
          return { ok: false, reason: "expired" };
        }
        const record = createCaptureAttachmentRecord({
          ...current,
          state: "ready",
          readyContentType: input.readyContentType,
          actualByteSize: input.actualByteSize,
          serverSha256: input.serverSha256,
          readyAt: input.now,
          updatedAt: input.now,
          pendingExpiresAt: undefined
        });
        state.records.set(record.attachmentId, record);
        return { ok: true, record };
      });
    },
    refuse(input: RefuseCaptureAttachmentInput): Promise<RefuseCaptureAttachmentOutcome> {
      return serializeWrite(() => {
        const current = state.records.get(input.attachmentId);
        if (
          current === undefined ||
          !matchesScope(current, input.projectId, input.captureId, input.attachmentId)
        ) {
          return { ok: false, reason: "not-found" };
        }
        if (current.state !== "pending") {
          return { ok: false, reason: "not-pending" };
        }
        const record = createCaptureAttachmentRecord({
          ...current,
          state: "refused",
          refusalCode: input.refusalCode,
          updatedAt: input.now,
          pendingExpiresAt: undefined
        });
        state.records.set(record.attachmentId, record);
        return { ok: true, record };
      });
    },
    delete(input: DeleteCaptureAttachmentInput): Promise<DeleteCaptureAttachmentOutcome> {
      return serializeWrite(() => {
        const current = state.records.get(input.attachmentId);
        if (
          current === undefined ||
          !matchesScope(current, input.projectId, input.captureId, input.attachmentId)
        ) {
          return { ok: false, reason: "not-found" };
        }
        if (current.state === "deleted") {
          return { ok: false, reason: "already-deleted" };
        }
        const record = createCaptureAttachmentRecord({
          ...current,
          state: "deleted",
          updatedAt: input.now,
          deletedAt: input.now,
          pendingExpiresAt: undefined
        });
        state.records.set(record.attachmentId, record);
        return { ok: true, record };
      });
    },
    removePending(input: RemovePendingCaptureAttachmentInput): Promise<void> {
      return serializeWrite(() => {
        const current = state.records.get(input.attachmentId);
        if (
          current === undefined ||
          !matchesScope(current, input.projectId, input.captureId, input.attachmentId)
        ) {
          return;
        }
        if (current.state === "pending") {
          state.records.delete(input.attachmentId);
        }
      });
    },
    async listExpiredPending(now: string): Promise<readonly CaptureAttachmentRecord[]> {
      const expired = [];
      for (const record of state.records.values()) {
        if (record.state !== "pending") continue;
        if (
          record.pendingExpiresAt !== undefined &&
          isIsoBefore(record.pendingExpiresAt, now)
        ) {
          expired.push(createCaptureAttachmentRecord(record));
        }
      }
      return expired;
    }
  };

  repository[MEMORY_TRANSACTION_STATE] = Object.freeze({
    snapshot: () => cloneMemoryCaptureAttachmentState(state),
    restore(snapshot: unknown): void {
      state = cloneMemoryCaptureAttachmentState(snapshot as MemoryCaptureAttachmentState);
    }
  });

  return Object.freeze(repository);
}
