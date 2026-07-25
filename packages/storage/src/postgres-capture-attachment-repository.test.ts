import { afterEach, describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID,
  CAPTURE_ATTACHMENT_MAX_PER_CAPTURE,
  CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES,
  CaptureAttachmentStorageError,
  DomainValidationError,
  accountId,
  attachmentId,
  captureId,
  createCaptureAttachmentRecord,
  createCaptureServices,
  createProjectMembership,
  projectId,
  sha256Digest
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import { createPgliteDatabase, migratePgliteRepositoryDatabase } from "./pglite.js";
import { createPostgresCaptureAttachmentRepository } from "./postgres-capture-attachment-repository.js";
import { createPostgresCaptureDocumentRepository } from "./postgres-capture-document-repository.js";
import { createPostgresProjectRepository } from "./postgres-project-repository.js";
import { captureAttachments, user } from "./schema.js";
import { seedProject } from "./seed.js";

const closers: Array<() => Promise<void>> = [];
const OWNER_ACCOUNT_ID = accountId("account-attachment-owner");
const NOW = "2026-07-24T12:00:00.000Z";
const LATER = "2026-07-25T12:00:00.000Z";
const EXPIRED = "2026-07-23T12:00:00.000Z";

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

async function setup() {
  const { db, close } = createPgliteDatabase();
  closers.push(close);
  await migratePgliteRepositoryDatabase(db);
  await db.insert(user).values({
    id: OWNER_ACCOUNT_ID,
    name: "Attachment Owner",
    email: "attachment-owner@example.test",
    emailVerified: true
  });
  const repositoryDatabase = toRepositoryDatabase(db);
  const projectRepository = createPostgresProjectRepository(repositoryDatabase);
  await seedProject(projectRepository, BELLWETHER_FIXTURE);
  await projectRepository.transaction((writer) => {
    writer.insertProjectMembership(
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER_ACCOUNT_ID,
        role: "owner",
        createdAt: NOW
      })
    );
  });

  let now = NOW;
  let nextId = 0;
  const captureDocuments = createPostgresCaptureDocumentRepository(repositoryDatabase);
  const attachments = createPostgresCaptureAttachmentRepository(repositoryDatabase);
  const captureServices = createCaptureServices({
    projects: projectRepository,
    captureDocuments,
    ids: {
      create(kind) {
        nextId += 1;
        return `${kind}-${nextId}`;
      }
    },
    clock: { now: () => now }
  });

  return {
    db,
    projectRepository,
    captureDocuments,
    attachments,
    captureServices,
    setNow(value: string) {
      now = value;
    }
  };
}

async function createCapture(
  captureServices: Awaited<ReturnType<typeof setup>>["captureServices"]
) {
  const created = await captureServices.createCapture({
    accountId: OWNER_ACCOUNT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sourceModality: "text"
  });
  await captureServices.saveCaptureDocument({
    accountId: OWNER_ACCOUNT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    captureId: created.captureId,
    expectedWorkingVersion: 1,
    document: {
      schemaVersion: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: `block-${created.captureId}` },
            content: [{ type: "text", text: "Attachment host capture." }]
          }
        ]
      }
    }
  });
  return created;
}

function pendingRecord(input: Readonly<{
  attachmentId: string;
  captureId: string;
  projectId?: string;
  declaredByteSize?: number;
  objectKey?: string;
  pendingExpiresAt?: string;
}>) {
  const scopedProjectId = projectId(input.projectId ?? BELLWETHER_FIXTURE_PROJECT_ID);
  const scopedCaptureId = captureId(input.captureId);
  const scopedAttachmentId = attachmentId(input.attachmentId);
  return createCaptureAttachmentRecord({
    attachmentId: scopedAttachmentId,
    captureId: scopedCaptureId,
    projectId: scopedProjectId,
    state: "pending",
    displayFilename: `${input.attachmentId}.txt`,
    declaredContentType: "text/plain",
    declaredByteSize: input.declaredByteSize ?? 1024,
    clientSha256: sha256Digest("a".repeat(64)),
    objectKey:
      input.objectKey ??
      `projects/${scopedProjectId}/captures/${scopedCaptureId}/attachments/${scopedAttachmentId}`,
    pendingExpiresAt: input.pendingExpiresAt ?? LATER,
    createdAt: NOW,
    updatedAt: NOW
  });
}

describe("postgres capture attachment repository", () => {
  it("applies attachment migrations from an empty database", async () => {
    const { db } = await setup();
    expect(await db.select().from(captureAttachments)).toEqual([]);
  });

  it("reserves, lists, and reads attachment metadata with all fields", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const record = pendingRecord({
      attachmentId: "att-read",
      captureId: capture.captureId
    });

    const reserved = await attachments.reserve({ record });
    expect(reserved).toEqual({ ok: true, record });

    const loaded = await attachments.get(record.attachmentId);
    expect(loaded).toEqual(record);

    const listed = await attachments.listByCapture(
      BELLWETHER_FIXTURE_PROJECT_ID,
      capture.captureId
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      attachmentId: record.attachmentId,
      captureId: record.captureId,
      projectId: record.projectId,
      state: "pending",
      displayFilename: record.displayFilename,
      declaredContentType: "text/plain",
      declaredByteSize: record.declaredByteSize,
      pendingExpiresAt: record.pendingExpiresAt,
      createdAt: NOW,
      updatedAt: NOW
    });
  });

  it("enforces per-capture count and project byte quotas", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);

    for (let index = 0; index < CAPTURE_ATTACHMENT_MAX_PER_CAPTURE; index += 1) {
      const outcome = await attachments.reserve({
        record: pendingRecord({
          attachmentId: `att-count-${index}`,
          captureId: capture.captureId,
          declaredByteSize: 1
        })
      });
      expect(outcome.ok).toBe(true);
    }

    const countExceeded = await attachments.reserve({
      record: pendingRecord({
        attachmentId: "att-count-overflow",
        captureId: capture.captureId,
        declaredByteSize: 1
      })
    });
    expect(countExceeded).toEqual({ ok: false, reason: "attachment-count-exceeded" });

    const otherCapture = await createCapture(captureServices);
    const quotaExceeded = await attachments.reserve({
      record: pendingRecord({
        attachmentId: "att-quota-overflow",
        captureId: otherCapture.captureId,
        declaredByteSize: CAPTURE_ATTACHMENT_MAX_PROJECT_BYTES
      })
    });
    expect(quotaExceeded).toEqual({ ok: false, reason: "project-quota-exceeded" });
  });

  it("serializes concurrent reservations so capture limits hold", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const attempts = Array.from(
      { length: CAPTURE_ATTACHMENT_MAX_PER_CAPTURE + 5 },
      (_, index) =>
        attachments.reserve({
          record: pendingRecord({
            attachmentId: `att-race-${index}`,
            captureId: capture.captureId,
            declaredByteSize: 1
          })
        })
    );
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(
      CAPTURE_ATTACHMENT_MAX_PER_CAPTURE
    );
  });

  it("returns not-found for cross-scope finalize, refuse, and delete", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const otherCapture = await createCapture(captureServices);
    const record = pendingRecord({
      attachmentId: "att-scope",
      captureId: capture.captureId
    });
    await attachments.reserve({ record });

    expect(
      await attachments.finalize({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: otherCapture.captureId,
        attachmentId: record.attachmentId,
        readyContentType: "text/plain",
        actualByteSize: 10,
        serverSha256: sha256Digest("b".repeat(64)),
        now: NOW
      })
    ).toEqual({ ok: false, reason: "not-found" });

    expect(
      await attachments.refuse({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: otherCapture.captureId,
        attachmentId: record.attachmentId,
        refusalCode: "unsupported-type",
        now: NOW
      })
    ).toEqual({ ok: false, reason: "not-found" });

    expect(
      await attachments.delete({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: otherCapture.captureId,
        attachmentId: record.attachmentId,
        now: NOW
      })
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("finalizes, refuses, and rejects expired pending attachments", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const pending = pendingRecord({
      attachmentId: "att-finalize",
      captureId: capture.captureId
    });
    await attachments.reserve({ record: pending });

    const finalized = await attachments.finalize({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: pending.attachmentId,
      readyContentType: "text/plain",
      actualByteSize: 512,
      serverSha256: sha256Digest("c".repeat(64)),
      now: NOW
    });
    expect(finalized.ok).toBe(true);
    if (finalized.ok) {
      expect(finalized.record.state).toBe("ready");
      expect(finalized.record.readyAt).toBe(NOW);
      expect(finalized.record.pendingExpiresAt).toBeUndefined();
    }

    const refusedPending = pendingRecord({
      attachmentId: "att-refuse",
      captureId: capture.captureId
    });
    await attachments.reserve({ record: refusedPending });
    const refused = await attachments.refuse({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: refusedPending.attachmentId,
      refusalCode: "checksum-mismatch",
      now: NOW
    });
    expect(refused.ok).toBe(true);
    if (refused.ok) {
      expect(refused.record.state).toBe("refused");
      expect(refused.record.refusalCode).toBe("checksum-mismatch");
    }

    const expiredPending = pendingRecord({
      attachmentId: "att-expired",
      captureId: capture.captureId,
      pendingExpiresAt: EXPIRED
    });
    await attachments.reserve({ record: expiredPending });
    expect(
      await attachments.finalize({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: expiredPending.attachmentId,
        readyContentType: "text/plain",
        actualByteSize: 10,
        serverSha256: sha256Digest("d".repeat(64)),
        now: NOW
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("tombstones deleted attachments and rejects repeat delete", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const record = pendingRecord({
      attachmentId: "att-delete",
      captureId: capture.captureId
    });
    await attachments.reserve({ record });

    const deleted = await attachments.delete({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: record.attachmentId,
      now: NOW
    });
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.record.state).toBe("deleted");
      expect(deleted.record.deletedAt).toBe(NOW);
    }

    expect(
      await attachments.delete({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: record.attachmentId,
        now: NOW
      })
    ).toEqual({ ok: false, reason: "already-deleted" });

    const tombstone = await attachments.get(record.attachmentId);
    expect(tombstone?.state).toBe("deleted");
  });

  it("lists expired pending attachments and removes only pending rows", async () => {
    const { attachments, captureServices, db } = await setup();
    const capture = await createCapture(captureServices);
    const expired = pendingRecord({
      attachmentId: "att-expired-list",
      captureId: capture.captureId,
      pendingExpiresAt: EXPIRED
    });
    const active = pendingRecord({
      attachmentId: "att-active-list",
      captureId: capture.captureId,
      pendingExpiresAt: LATER
    });
    const readyPending = pendingRecord({
      attachmentId: "att-ready-list",
      captureId: capture.captureId,
      pendingExpiresAt: LATER
    });
    await attachments.reserve({ record: expired });
    await attachments.reserve({ record: active });
    await attachments.reserve({ record: readyPending });

    const listed = await attachments.listExpiredPending(NOW);
    expect(listed.map((record) => record.attachmentId)).toEqual([expired.attachmentId]);

    await attachments.removePending({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: active.attachmentId
    });
    expect(await attachments.get(active.attachmentId)).toBeUndefined();
    expect(await attachments.get(expired.attachmentId)).toBeDefined();

    await attachments.finalize({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: readyPending.attachmentId,
      readyContentType: "text/plain",
      actualByteSize: 10,
      serverSha256: sha256Digest("e".repeat(64)),
      now: NOW
    });
    await attachments.removePending({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: readyPending.attachmentId
    });
    expect(await attachments.get(readyPending.attachmentId)).toBeDefined();
    expect(await db.select().from(captureAttachments)).toHaveLength(2);
  });

  it("refuses duplicate attachment IDs and object keys", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const record = pendingRecord({
      attachmentId: "att-dup-id",
      captureId: capture.captureId
    });
    await attachments.reserve({ record });

    const identical = await attachments.reserve({ record });
    expect(identical).toEqual({ ok: true, record });

    const conflicting = pendingRecord({
      attachmentId: "att-dup-id",
      captureId: capture.captureId,
      declaredByteSize: 2048
    });
    await expect(attachments.reserve({ record: conflicting })).rejects.toBeInstanceOf(
      CaptureAttachmentStorageError
    );

    const firstKey = pendingRecord({
      attachmentId: "att-key-a",
      captureId: capture.captureId,
      objectKey: "projects/shared/object-key"
    });
    await attachments.reserve({ record: firstKey });

    const duplicateKey = pendingRecord({
      attachmentId: "att-key-b",
      captureId: capture.captureId,
      objectKey: "projects/shared/object-key"
    });
    await expect(attachments.reserve({ record: duplicateKey })).rejects.toBeInstanceOf(
      CaptureAttachmentStorageError
    );
  });

  it("rejects reservations that violate foreign keys", async () => {
    const { attachments, captureServices } = await setup();
    const capture = await createCapture(captureServices);
    const missingCapture = pendingRecord({
      attachmentId: "att-missing-capture",
      captureId: "capture-missing"
    });
    await expect(attachments.reserve({ record: missingCapture })).rejects.toBeInstanceOf(
      DomainValidationError
    );

    const missingProject = pendingRecord({
      attachmentId: "att-missing-project",
      captureId: capture.captureId,
      projectId: "project-missing"
    });
    await expect(attachments.reserve({ record: missingProject })).rejects.toBeInstanceOf(
      DomainValidationError
    );
  });

  it("does not change capture or project versions", async () => {
    const { attachments, captureDocuments, captureServices, projectRepository } =
      await setup();
    const capture = await createCapture(captureServices);
    const beforeCapture = await captureDocuments.get(capture.captureId);
    const beforeProject = await projectRepository.getProject(BELLWETHER_FIXTURE_PROJECT_ID);

    const record = pendingRecord({
      attachmentId: "att-version-neutral",
      captureId: capture.captureId
    });
    await attachments.reserve({ record });
    await attachments.finalize({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: record.attachmentId,
      readyContentType: "text/plain",
      actualByteSize: 10,
      serverSha256: sha256Digest("f".repeat(64)),
      now: NOW
    });
    await attachments.delete({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: record.attachmentId,
      now: NOW
    });

    const afterCapture = await captureDocuments.get(capture.captureId);
    const afterProject = await projectRepository.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(afterCapture?.workingVersion).toBe(beforeCapture?.workingVersion);
    expect(afterProject?.version).toBe(beforeProject?.version);
  });
});
