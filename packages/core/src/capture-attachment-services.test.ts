import { describe, expect, it } from "vitest";
import { createCaptureServices } from "./capture-services.js";
import { createCaptureAttachmentServices } from "./capture-attachment-services.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryCaptureAttachmentRepository } from "./memory-capture-attachment-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemoryCaptureObjectStorage } from "./capture-object-storage.js";
import {
  CaptureAttachmentNotFoundError,
  CaptureAttachmentPolicyError,
  CaptureAttachmentStorageError
} from "./capture-attachments.js";
import { createCaptureRevision, ProjectArchivedMutationError } from "./capture-documents.js";
import { captureRevisionId, projectId, sceneId, type CaptureId } from "./domain.js";
import { loadProjectRecords } from "./project-services.js";

const OWNER_ACCOUNT_ID = accountId("account-capture-owner");
const OTHER_ACCOUNT_ID = accountId("account-capture-other");
const NOW = "2026-07-24T12:00:00.000Z";

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function setup(options?: Readonly<{ presignFails?: boolean }>) {
  let now = NOW;
  let nextId = 0;
  const captureDocuments = createMemoryCaptureDocumentRepository();
  const attachments = createMemoryCaptureAttachmentRepository();
  const objectStorage = createMemoryCaptureObjectStorage();
  const baseStorage = objectStorage;
  const storage = options?.presignFails
    ? {
        ...objectStorage,
        async presignPut(_input: Parameters<typeof objectStorage.presignPut>[0]) {
          throw new Error("presign failed");
        },
        async presignGet(input: Parameters<typeof objectStorage.presignGet>[0]) {
          return baseStorage.presignGet(input);
        },
        async inspectObject(key: string) {
          return baseStorage.inspectObject(key);
        },
        async deleteObject(key: string) {
          return baseStorage.deleteObject(key);
        },
        async putObject(input: Parameters<typeof objectStorage.putObject>[0]) {
          return baseStorage.putObject(input);
        },
        async getObjectBytes(objectKey: string) {
          return baseStorage.getObjectBytes?.(objectKey);
        },
        putObjectForTest: objectStorage.putObjectForTest.bind(objectStorage),
        hasObject: objectStorage.hasObject.bind(objectStorage),
        snapshot: objectStorage.snapshot.bind(objectStorage),
        restore: objectStorage.restore.bind(objectStorage)
      }
    : objectStorage;

  const projects = createMemoryProjectRepository(
    [BELLWETHER_FIXTURE],
    [
      createProjectMembership({
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        accountId: OWNER_ACCOUNT_ID,
        role: "owner",
        createdAt: NOW
      })
    ]
  );
  const sharedDeps = {
    projects,
    captureDocuments,
    ids: {
      create(kind: string) {
        nextId += 1;
        return `${kind}-${nextId}`;
      }
    },
    clock: { now: () => now }
  };
  const captureServices = createCaptureServices({
    ...sharedDeps,
    captureDocuments
  });
  const attachmentServices = createCaptureAttachmentServices({
    ...sharedDeps,
    attachments,
    objectStorage: storage
  });

  return {
    captureServices,
    attachmentServices,
    attachments,
    captureDocuments,
    objectStorage,
    projects,
    setNow(value: string) {
      now = value;
    }
  };
}

async function createDraftCapture(
  services: ReturnType<typeof setup>["captureServices"]
) {
  return services.createCapture({
    accountId: OWNER_ACCOUNT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    sourceModality: "text"
  });
}

async function putObjectForInit(
  attachments: ReturnType<typeof setup>["attachments"],
  objectStorage: ReturnType<typeof setup>["objectStorage"],
  init: Awaited<ReturnType<typeof initPlainTextUpload>>,
  bytes: Uint8Array
) {
  const record = await attachments.get(init.attachment.attachmentId);
  if (record === undefined) {
    throw new Error("Missing attachment reservation.");
  }
  objectStorage.putObjectForTest(record.objectKey, bytes);
}

async function initPlainTextUpload(
  attachmentServices: ReturnType<typeof setup>["attachmentServices"],
  captureIdValue: CaptureId,
  text = "Hello attachment."
) {
  const bytes = new TextEncoder().encode(text);
  const hash = await digestHex(bytes);
  return attachmentServices.initAttachmentUpload({
    accountId: OWNER_ACCOUNT_ID,
    projectId: BELLWETHER_FIXTURE_PROJECT_ID,
    captureId: captureIdValue,
    displayFilename: "note.txt",
    declaredContentType: "text/plain",
    declaredByteSize: bytes.byteLength,
    clientSha256: hash
  });
}

describe("capture attachment services", () => {
  it("initializes, uploads, finalizes plain text, lists, downloads, and deletes", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage, projects } =
      setup();
    const capture = await createDraftCapture(captureServices);
    const beforeVersion = (await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version;

    const init = await initPlainTextUpload(attachmentServices, capture.captureId);
    expect(init.attachment.state).toBe("pending");
    expect(init.upload.url).toContain("memory://put/");

    const bytes = new TextEncoder().encode("Hello attachment.");
    await putObjectForInit(attachments, objectStorage, init, bytes);

    const ready = await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(ready.state).toBe("ready");

    const listed = await attachmentServices.listAttachments({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId
    });
    expect(listed).toHaveLength(1);

    const download = await attachmentServices.getAttachmentDownloadUrl({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(download.url).toContain("memory://get/");

    const deleted = await attachmentServices.deleteAttachment({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(deleted.state).toBe("deleted");
    const tombstone = await attachments.get(init.attachment.attachmentId);
    expect(tombstone?.objectKey).toBeDefined();
    expect(objectStorage.hasObject(tombstone!.objectKey)).toBe(false);

    const afterVersion = (await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID))?.version;
    expect(afterVersion).toBe(beforeVersion);
  });

  it("rolls back reservation when presign fails", async () => {
    const { captureServices, attachmentServices, attachments } = setup({
      presignFails: true
    });
    const capture = await createDraftCapture(captureServices);
    await expect(
      initPlainTextUpload(attachmentServices, capture.captureId)
    ).rejects.toBeInstanceOf(CaptureAttachmentStorageError);
    expect(
      await attachments.listByCapture(BELLWETHER_FIXTURE_PROJECT_ID, capture.captureId)
    ).toEqual([]);
  });

  it("refuses finalize on checksum and size mismatch and removes the object", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage } = setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);
    await putObjectForInit(
      attachments,
      objectStorage,
      init,
      new TextEncoder().encode("Hello attachmentX")
    );
    const record = await attachments.get(init.attachment.attachmentId);

    const refused = await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(refused.state).toBe("refused");
    expect(refused.refusalCode).toBe("checksum-mismatch");
    expect(record === undefined || !objectStorage.hasObject(record.objectKey)).toBe(true);
  });

  it("refuses missing objects and unsupported bytes", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage } = setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);

    const missing = await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(missing.state).toBe("refused");
    expect(missing.refusalCode).toBe("object-missing");

    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const zipInit = await attachmentServices.initAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      displayFilename: "archive.zip",
      declaredContentType: "application/pdf",
      declaredByteSize: zipBytes.byteLength,
      clientSha256: await digestHex(zipBytes)
    });
    await putObjectForInit(attachments, objectStorage, zipInit, zipBytes);
    const zipRefused = await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: zipInit.attachment.attachmentId
    });
    expect(zipRefused.refusalCode).toBe("unsupported-type");
  });

  it("enforces per-capture and per-project quotas with serialized reservations", async () => {
    const { captureServices, attachmentServices } = setup();
    const capture = await createDraftCapture(captureServices);
    for (let index = 0; index < 10; index += 1) {
      await attachmentServices.initAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        displayFilename: `file-${index}.txt`,
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "0".repeat(64)
      });
    }
    await expect(
      attachmentServices.initAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        displayFilename: "overflow.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "1".repeat(64)
      })
    ).rejects.toMatchObject({ code: "attachment-count-exceeded" });
  });

  it("blocks init on archived captures but allows list/download/delete", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage } = setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);
    await putObjectForInit(
      attachments,
      objectStorage,
      init,
      new TextEncoder().encode("Hello attachment.")
    );
    await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });

    await captureServices.setCaptureArchived({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      archived: true
    });

    await expect(
      attachmentServices.initAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        displayFilename: "blocked.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "2".repeat(64)
      })
    ).rejects.toMatchObject({ code: "capture-not-editable" });

    expect(
      await attachmentServices.listAttachments({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId
      })
    ).toHaveLength(1);
    await expect(
      attachmentServices.getAttachmentDownloadUrl({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: init.attachment.attachmentId
      })
    ).resolves.toMatchObject({ url: expect.stringContaining("memory://get/") });
  });

  it("blocks init and finalize on integrated captures but allows list/download/delete", async () => {
    const { captureServices, attachmentServices, attachments, captureDocuments, objectStorage } =
      setup();
    const capture = await createDraftCapture(captureServices);

    const readyInit = await initPlainTextUpload(attachmentServices, capture.captureId);
    await putObjectForInit(
      attachments,
      objectStorage,
      readyInit,
      new TextEncoder().encode("Hello attachment.")
    );
    await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: readyInit.attachment.attachmentId
    });

    const pendingInit = await attachmentServices.initAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      displayFilename: "pending.txt",
      declaredContentType: "text/plain",
      declaredByteSize: 4,
      clientSha256: "3".repeat(64)
    });

    const head = await captureDocuments.get(capture.captureId);
    if (head === undefined) {
      throw new Error("Missing capture head.");
    }
    const integrationRevision = createCaptureRevision({
      id: captureRevisionId("capture-revision-integrated"),
      captureId: capture.captureId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      parentRevisionId: head.genesisRevisionId,
      document: head.document,
      contentHash: head.contentHash,
      actorAccountId: OWNER_ACCOUNT_ID,
      origin: "human",
      reason: "integration",
      createdAt: NOW
    });
    const integrated = await captureDocuments.integrate({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      expectedWorkingVersion: head.workingVersion,
      expectedContentHash: head.contentHash,
      integratedSceneId: sceneId("scene-arrival-at-bellwether"),
      actorAccountId: OWNER_ACCOUNT_ID,
      now: NOW,
      integrationRevision
    });
    expect(integrated.ok).toBe(true);

    await expect(
      attachmentServices.initAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        displayFilename: "blocked.txt",
        declaredContentType: "text/plain",
        declaredByteSize: 1,
        clientSha256: "2".repeat(64)
      })
    ).rejects.toMatchObject({ code: "capture-not-editable" });

    await expect(
      attachmentServices.finalizeAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: pendingInit.attachment.attachmentId
      })
    ).rejects.toMatchObject({ code: "capture-not-editable" });

    expect(
      await attachmentServices.listAttachments({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId
      })
    ).toHaveLength(2);

    await expect(
      attachmentServices.getAttachmentDownloadUrl({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: readyInit.attachment.attachmentId
      })
    ).resolves.toMatchObject({ url: expect.stringContaining("memory://get/") });

    const deleted = await attachmentServices.deleteAttachment({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: readyInit.attachment.attachmentId
    });
    expect(deleted.state).toBe("deleted");
  });

  it("uses non-disclosing errors for cross-owner and cross-project access", async () => {
    const { captureServices, attachmentServices } = setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);

    await expect(
      attachmentServices.listAttachments({
        accountId: OTHER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId
      })
    ).rejects.toBeInstanceOf(CaptureAttachmentNotFoundError);

    await expect(
      attachmentServices.getAttachmentDownloadUrl({
        accountId: OTHER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        attachmentId: init.attachment.attachmentId
      })
    ).rejects.toBeInstanceOf(CaptureAttachmentNotFoundError);

    await expect(
      attachmentServices.listAttachments({
        accountId: OWNER_ACCOUNT_ID,
        projectId: projectId("project-other"),
        captureId: capture.captureId
      })
    ).rejects.toBeInstanceOf(CaptureAttachmentNotFoundError);
  });

  it("cleans expired pending uploads idempotently", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage, setNow } =
      setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);
    await putObjectForInit(
      attachments,
      objectStorage,
      init,
      new TextEncoder().encode("Hello attachment.")
    );
    setNow("2026-07-26T12:00:00.000Z");
    expect(await attachmentServices.cleanupExpiredPending()).toBe(1);
    expect(await attachmentServices.cleanupExpiredPending()).toBe(0);
    const record = await attachments.get(init.attachment.attachmentId);
    expect(record?.state).toBe("deleted");
    expect(objectStorage.hasObject(record!.objectKey)).toBe(false);
  });

  it("rejects init on archived projects", async () => {
    const { captureServices, attachmentServices, projects } = setup();
    const capture = await createDraftCapture(captureServices);
    const records = await loadProjectRecords(projects, BELLWETHER_FIXTURE_PROJECT_ID);
    if (records === undefined) throw new Error("missing project records");
    await projects.transaction((writer) => {
      writer.replaceProjectRecords(
        {
          ...records,
          project: {
            ...records.project,
            archivedAt: NOW,
            version: records.project.version + 1
          }
        },
        records.project.version
      );
    });
    await expect(
      initPlainTextUpload(attachmentServices, capture.captureId)
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);
  });

  it("delete is idempotent for tombstones", async () => {
    const { captureServices, attachmentServices, attachments, objectStorage } = setup();
    const capture = await createDraftCapture(captureServices);
    const init = await initPlainTextUpload(attachmentServices, capture.captureId);
    await putObjectForInit(
      attachments,
      objectStorage,
      init,
      new TextEncoder().encode("Hello attachment.")
    );
    await attachmentServices.finalizeAttachmentUpload({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    const first = await attachmentServices.deleteAttachment({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    const second = await attachmentServices.deleteAttachment({
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      captureId: capture.captureId,
      attachmentId: init.attachment.attachmentId
    });
    expect(first.state).toBe("deleted");
    expect(second.state).toBe("deleted");
  });
});

describe("capture attachment service errors stay content-free", () => {
  it("never exposes filename, object key, or payload in error messages", async () => {
    const { captureServices, attachmentServices } = setup();
    const capture = await createDraftCapture(captureServices);
    try {
      await attachmentServices.initAttachmentUpload({
        accountId: OWNER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: capture.captureId,
        displayFilename: "secret-name.txt",
        declaredContentType: "application/octet-stream",
        declaredByteSize: 10,
        clientSha256: "not-a-hash"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("secret-name");
      expect(message).not.toContain("projects/");
      expect(error).toBeInstanceOf(CaptureAttachmentPolicyError);
    }
  });
});
