import {
  attachmentId,
  captureId,
  projectId,
  DomainValidationError,
  CAPTURE_ATTACHMENT_MAX_PER_CAPTURE,
  CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES,
  CaptureAttachmentStorageError,
  attachmentCountsTowardQuota,
  captureAttachmentSummaryFromRecord,
  createCaptureAttachmentRecord,
  isIsoBefore,
  type AttachmentId,
  type CaptureAttachmentRecord,
  type CaptureAttachmentRepository,
  type CaptureId,
  type DeleteCaptureAttachmentInput,
  type DeleteCaptureAttachmentOutcome,
  type FinalizeCaptureAttachmentInput,
  type FinalizeCaptureAttachmentOutcome,
  type ProjectId,
  type RefuseCaptureAttachmentInput,
  type RefuseCaptureAttachmentOutcome,
  type RemovePendingCaptureAttachmentInput,
  type ReserveCaptureAttachmentInput,
  type ReserveCaptureAttachmentOutcome
} from "@ghostwriter/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { captureAttachments, projects } from "./schema.js";

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== undefined && current !== null;
    depth += 1
  ) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return undefined;
}

function mapAttachmentPersistenceError(error: unknown): never {
  if (error instanceof DomainValidationError) throw error;
  if (error instanceof CaptureAttachmentStorageError) throw error;
  const code = postgresErrorCode(error);
  if (code === "23503") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The capture attachment references a record that does not exist."
    );
  }
  if (code === "23505") {
    throw new CaptureAttachmentStorageError();
  }
  throw new CaptureAttachmentStorageError();
}

function rowToRecord(
  row: typeof captureAttachments.$inferSelect
): CaptureAttachmentRecord {
  return createCaptureAttachmentRecord({
    attachmentId: attachmentId(row.attachmentId),
    captureId: captureId(row.captureId),
    projectId: projectId(row.projectId),
    state: row.state as CaptureAttachmentRecord["state"],
    displayFilename: row.displayFilename,
    declaredContentType:
      row.declaredContentType as CaptureAttachmentRecord["declaredContentType"],
    declaredByteSize: row.declaredByteSize,
    clientSha256: row.clientSha256 as CaptureAttachmentRecord["clientSha256"],
    objectKey: row.objectKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.readyContentType === null
      ? {}
      : {
          readyContentType:
            row.readyContentType as CaptureAttachmentRecord["readyContentType"]
        }),
    ...(row.actualByteSize === null ? {} : { actualByteSize: row.actualByteSize }),
    ...(row.serverSha256 === null
      ? {}
      : {
          serverSha256:
            row.serverSha256 as CaptureAttachmentRecord["serverSha256"]
        }),
    ...(row.pendingExpiresAt === null
      ? {}
      : { pendingExpiresAt: row.pendingExpiresAt }),
    ...(row.refusalCode === null
      ? {}
      : {
          refusalCode:
            row.refusalCode as CaptureAttachmentRecord["refusalCode"]
        }),
    ...(row.readyAt === null ? {} : { readyAt: row.readyAt }),
    ...(row.deletedAt === null ? {} : { deletedAt: row.deletedAt })
  });
}

function recordToInsertRow(record: CaptureAttachmentRecord) {
  return {
    attachmentId: record.attachmentId,
    captureId: record.captureId,
    projectId: record.projectId,
    state: record.state,
    displayFilename: record.displayFilename,
    declaredContentType: record.declaredContentType,
    readyContentType: record.readyContentType ?? null,
    declaredByteSize: record.declaredByteSize,
    actualByteSize: record.actualByteSize ?? null,
    clientSha256: record.clientSha256,
    serverSha256: record.serverSha256 ?? null,
    objectKey: record.objectKey,
    pendingExpiresAt: record.pendingExpiresAt ?? null,
    refusalCode: record.refusalCode ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    readyAt: record.readyAt ?? null,
    deletedAt: record.deletedAt ?? null
  };
}

function recordsEquivalent(
  left: CaptureAttachmentRecord,
  right: CaptureAttachmentRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function quotaByteSize(
  state: CaptureAttachmentRecord["state"],
  declaredByteSize: number,
  actualByteSize: number | null
): number {
  if (!attachmentCountsTowardQuota(state)) return 0;
  if (state === "ready" && actualByteSize !== null) return actualByteSize;
  return declaredByteSize;
}

async function lockProjectForAttachmentQuota(
  db: RepositoryDatabase,
  id: ProjectId
): Promise<void> {
  const locked = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .for("update");
  if (locked.length === 0) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The capture attachment references a record that does not exist."
    );
  }
}

async function countActiveForCapture(
  db: RepositoryDatabase,
  scopedProjectId: ProjectId,
  scopedCaptureId: CaptureId
): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`
    })
    .from(captureAttachments)
    .where(
      and(
        eq(captureAttachments.projectId, scopedProjectId),
        eq(captureAttachments.captureId, scopedCaptureId),
        inArray(captureAttachments.state, ["pending", "ready"])
      )
    );
  return row?.count ?? 0;
}

async function sumActiveBytesForProject(
  db: RepositoryDatabase,
  scopedProjectId: ProjectId
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(case
        when ${captureAttachments.state} = 'ready' and ${captureAttachments.actualByteSize} is not null
          then ${captureAttachments.actualByteSize}
        when ${captureAttachments.state} in ('pending', 'ready')
          then ${captureAttachments.declaredByteSize}
        else 0
      end), 0)::int`
    })
    .from(captureAttachments)
    .where(
      and(
        eq(captureAttachments.projectId, scopedProjectId),
        inArray(captureAttachments.state, ["pending", "ready"])
      )
    );
  return row?.total ?? 0;
}

async function queryByAttachmentId(
  db: RepositoryDatabase,
  id: AttachmentId
): Promise<CaptureAttachmentRecord | undefined> {
  const [row] = await db
    .select()
    .from(captureAttachments)
    .where(eq(captureAttachments.attachmentId, id))
    .limit(1);
  return row === undefined ? undefined : rowToRecord(row);
}

function matchesScope(
  record: CaptureAttachmentRecord,
  scopedProjectId: ProjectId,
  scopedCaptureId: CaptureId,
  scopedAttachmentId: AttachmentId
): boolean {
  return (
    record.attachmentId === scopedAttachmentId &&
    record.captureId === scopedCaptureId &&
    record.projectId === scopedProjectId
  );
}

async function reserveWithinTransaction(
  db: RepositoryDatabase,
  input: ReserveCaptureAttachmentInput
): Promise<ReserveCaptureAttachmentOutcome> {
  const record = createCaptureAttachmentRecord(input.record);
  if (record.state !== "pending") {
    throw new Error("Attachment reservation must start in the pending state.");
  }

  const existing = await queryByAttachmentId(db, record.attachmentId);
  if (existing !== undefined) {
    if (recordsEquivalent(existing, record)) {
      return { ok: true, record: existing };
    }
    throw new CaptureAttachmentStorageError();
  }

  await lockProjectForAttachmentQuota(db, record.projectId);

  const captureCount = await countActiveForCapture(
    db,
    record.projectId,
    record.captureId
  );
  if (captureCount >= CAPTURE_ATTACHMENT_MAX_PER_CAPTURE) {
    return { ok: false, reason: "attachment-count-exceeded" };
  }

  const projectBytes = await sumActiveBytesForProject(db, record.projectId);
  const reservationBytes = quotaByteSize(
    record.state,
    record.declaredByteSize,
    record.actualByteSize ?? null
  );
  if (projectBytes + reservationBytes > CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES) {
    return { ok: false, reason: "project-quota-exceeded" };
  }

  try {
    await db.insert(captureAttachments).values(recordToInsertRow(record));
  } catch (error) {
    mapAttachmentPersistenceError(error);
  }

  const stored = await queryByAttachmentId(db, record.attachmentId);
  if (stored === undefined) {
    throw new CaptureAttachmentStorageError();
  }
  return { ok: true, record: stored };
}

export function createPostgresCaptureAttachmentRepository(
  db: RepositoryDatabase
): CaptureAttachmentRepository {
  return Object.freeze({
    get(attachmentIdValue: AttachmentId): Promise<CaptureAttachmentRecord | undefined> {
      return queryByAttachmentId(db, attachmentIdValue);
    },

    async listByCapture(scopedProjectId: ProjectId, scopedCaptureId: CaptureId) {
      const rows = await db
        .select()
        .from(captureAttachments)
        .where(
          and(
            eq(captureAttachments.projectId, scopedProjectId),
            eq(captureAttachments.captureId, scopedCaptureId)
          )
        )
        .orderBy(
          desc(captureAttachments.createdAt),
          desc(captureAttachments.attachmentId)
        );
      return rows.map((row) => captureAttachmentSummaryFromRecord(rowToRecord(row)));
    },

    reserve(input: ReserveCaptureAttachmentInput): Promise<ReserveCaptureAttachmentOutcome> {
      return db.transaction(async (transaction) => {
        try {
          return await reserveWithinTransaction(
            transaction as unknown as RepositoryDatabase,
            input
          );
        } catch (error) {
          mapAttachmentPersistenceError(error);
        }
      });
    },

    finalize(
      input: FinalizeCaptureAttachmentInput
    ): Promise<FinalizeCaptureAttachmentOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        try {
          const current = await queryByAttachmentId(exec, input.attachmentId);
          if (
            current === undefined ||
            !matchesScope(
              current,
              input.projectId,
              input.captureId,
              input.attachmentId
            )
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

          const [updated] = await exec
            .update(captureAttachments)
            .set({
              state: "ready",
              readyContentType: input.readyContentType,
              actualByteSize: input.actualByteSize,
              serverSha256: input.serverSha256,
              readyAt: input.now,
              updatedAt: input.now,
              pendingExpiresAt: null
            })
            .where(
              and(
                eq(captureAttachments.attachmentId, input.attachmentId),
                eq(captureAttachments.projectId, input.projectId),
                eq(captureAttachments.captureId, input.captureId),
                eq(captureAttachments.state, "pending")
              )
            )
            .returning();

          if (updated === undefined) {
            const latest = await queryByAttachmentId(exec, input.attachmentId);
            if (
              latest === undefined ||
              !matchesScope(
                latest,
                input.projectId,
                input.captureId,
                input.attachmentId
              )
            ) {
              return { ok: false, reason: "not-found" };
            }
            if (latest.state !== "pending") {
              return { ok: false, reason: "not-pending" };
            }
            if (
              latest.pendingExpiresAt !== undefined &&
              isIsoBefore(latest.pendingExpiresAt, input.now)
            ) {
              return { ok: false, reason: "expired" };
            }
            throw new CaptureAttachmentStorageError();
          }

          return { ok: true, record: rowToRecord(updated) };
        } catch (error) {
          mapAttachmentPersistenceError(error);
        }
      });
    },

    refuse(
      input: RefuseCaptureAttachmentInput
    ): Promise<RefuseCaptureAttachmentOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        try {
          const current = await queryByAttachmentId(exec, input.attachmentId);
          if (
            current === undefined ||
            !matchesScope(
              current,
              input.projectId,
              input.captureId,
              input.attachmentId
            )
          ) {
            return { ok: false, reason: "not-found" };
          }
          if (current.state !== "pending") {
            return { ok: false, reason: "not-pending" };
          }

          const [updated] = await exec
            .update(captureAttachments)
            .set({
              state: "refused",
              refusalCode: input.refusalCode,
              updatedAt: input.now,
              pendingExpiresAt: null
            })
            .where(
              and(
                eq(captureAttachments.attachmentId, input.attachmentId),
                eq(captureAttachments.projectId, input.projectId),
                eq(captureAttachments.captureId, input.captureId),
                eq(captureAttachments.state, "pending")
              )
            )
            .returning();

          if (updated === undefined) {
            return { ok: false, reason: "not-pending" };
          }

          return { ok: true, record: rowToRecord(updated) };
        } catch (error) {
          mapAttachmentPersistenceError(error);
        }
      });
    },

    delete(
      input: DeleteCaptureAttachmentInput
    ): Promise<DeleteCaptureAttachmentOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        try {
          const current = await queryByAttachmentId(exec, input.attachmentId);
          if (
            current === undefined ||
            !matchesScope(
              current,
              input.projectId,
              input.captureId,
              input.attachmentId
            )
          ) {
            return { ok: false, reason: "not-found" };
          }
          if (current.state === "deleted") {
            return { ok: false, reason: "already-deleted" };
          }

          const [updated] = await exec
            .update(captureAttachments)
            .set({
              state: "deleted",
              updatedAt: input.now,
              deletedAt: input.now,
              pendingExpiresAt: null
            })
            .where(
              and(
                eq(captureAttachments.attachmentId, input.attachmentId),
                eq(captureAttachments.projectId, input.projectId),
                eq(captureAttachments.captureId, input.captureId),
                inArray(captureAttachments.state, ["pending", "ready", "refused"])
              )
            )
            .returning();

          if (updated === undefined) {
            const latest = await queryByAttachmentId(exec, input.attachmentId);
            if (
              latest === undefined ||
              !matchesScope(
                latest,
                input.projectId,
                input.captureId,
                input.attachmentId
              )
            ) {
              return { ok: false, reason: "not-found" };
            }
            if (latest.state === "deleted") {
              return { ok: false, reason: "already-deleted" };
            }
            throw new CaptureAttachmentStorageError();
          }

          return { ok: true, record: rowToRecord(updated) };
        } catch (error) {
          mapAttachmentPersistenceError(error);
        }
      });
    },

    removePending(input: RemovePendingCaptureAttachmentInput): Promise<void> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        try {
          await exec
            .delete(captureAttachments)
            .where(
              and(
                eq(captureAttachments.attachmentId, input.attachmentId),
                eq(captureAttachments.projectId, input.projectId),
                eq(captureAttachments.captureId, input.captureId),
                eq(captureAttachments.state, "pending")
              )
            );
        } catch (error) {
          mapAttachmentPersistenceError(error);
        }
      });
    },

    async listExpiredPending(now: string): Promise<readonly CaptureAttachmentRecord[]> {
      const rows = await db
        .select()
        .from(captureAttachments)
        .where(
          and(
            eq(captureAttachments.state, "pending"),
            sql`${captureAttachments.pendingExpiresAt} is not null`,
            sql`${captureAttachments.pendingExpiresAt} < ${now}`
          )
        );
      return rows.map((row) => rowToRecord(row));
    }
  });
}
