import { hashSceneDocument } from "@ghostwriter/editor";
import { describe, expect, it } from "vitest";
import { createCaptureServices } from "./capture-services.js";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryCaptureDocumentRepository } from "./memory-capture-document-repository.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import {
  CaptureArchivedMutationError,
  CaptureNotFoundError,
  CaptureVersionConflictError,
  InvalidCaptureDocumentError,
  ProjectArchivedMutationError
} from "./capture-documents.js";
import { captureId } from "./domain.js";
import { loadProjectRecords } from "./project-services.js";

const OWNER_ACCOUNT_ID = accountId("account-capture-owner");
const OTHER_ACCOUNT_ID = accountId("account-capture-other");
const NOW = "2026-07-12T18:00:00.000Z";

function documentWith(text: string, blockId = "block-capture-1") {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId },
          content: [{ type: "text", text }]
        }
      ]
    }
  } as const;
}

function setup() {
  let now = NOW;
  let nextId = 0;
  const captureDocuments = createMemoryCaptureDocumentRepository();
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
  const services = createCaptureServices({
    projects,
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
    services,
    projects,
    captureDocuments,
    setNow(value: string) {
      now = value;
    }
  };
}

describe("capture services with memory storage", () => {
  it("creates, reads, and lists acknowledged captures with genesis revision only", async () => {
    const { services, captureDocuments } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };

    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    expect(created).toMatchObject({
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      status: "draft",
      sourceModality: "text",
      workingVersion: 1
    });

    const loaded = await services.getCapture({
      ...scope,
      captureId: created.captureId
    });
    expect(loaded).toEqual(created);

    expect(await services.listCaptures(scope)).toEqual([]);

    const saved = await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("A lighthouse note.")
    });
    expect(saved.workingVersion).toBe(2);
    expect(await services.listCaptures(scope)).toEqual([
      expect.objectContaining({
        captureId: created.captureId,
        workingVersion: 2
      })
    ]);

    const genesis = await captureDocuments.getRevision(created.genesisRevisionId);
    expect(genesis).toMatchObject({ reason: "genesis", origin: "system" });
    expect(genesis?.contentHash).not.toBe(saved.contentHash);
  });

  it("does not advance project version when creating or saving captures", async () => {
    const { services, projects } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const before = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    const created = await services.createCapture({
      ...scope,
      sourceModality: "dictation"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Dictated fragment.")
    });
    const after = await projects.getProject(BELLWETHER_FIXTURE_PROJECT_ID);
    expect(after?.version).toBe(before?.version);
  });

  it("applies nothing on stale expected version conflicts", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("First save.")
    });

    await expect(
      services.saveCaptureDocument({
        ...scope,
        captureId: created.captureId,
        expectedWorkingVersion: 1,
        document: documentWith("Stale save.", "block-stale")
      })
    ).rejects.toBeInstanceOf(CaptureVersionConflictError);

    await expect(
      services.getCapture({ ...scope, captureId: created.captureId })
    ).resolves.toMatchObject({
      workingVersion: 2,
      document: documentWith("First save.")
    });
  });

  it("rejects invalid documents without mutating the capture", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });

    await expect(
      services.saveCaptureDocument({
        ...scope,
        captureId: created.captureId,
        expectedWorkingVersion: 1,
        document: { schemaVersion: 1, document: { type: "bad" } }
      })
    ).rejects.toBeInstanceOf(InvalidCaptureDocumentError);

    await expect(
      services.getCapture({ ...scope, captureId: created.captureId })
    ).resolves.toMatchObject({ workingVersion: 1 });
  });

  it("archives, restores, and filters archived captures from default lists", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Archive me.")
    });

    const archived = await services.setCaptureArchived({
      ...scope,
      captureId: created.captureId,
      archived: true
    });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBe(NOW);
    expect(await services.listCaptures(scope)).toEqual([]);
    expect(await services.listCaptures({ ...scope, includeArchived: true })).toEqual([
      expect.objectContaining({
        captureId: created.captureId,
        status: "archived",
        archivedAt: NOW
      })
    ]);

    const restored = await services.setCaptureArchived({
      ...scope,
      captureId: created.captureId,
      archived: false
    });
    expect(restored.status).toBe("draft");
    expect(restored.archivedAt).toBeUndefined();
    expect(await services.listCaptures(scope)).toEqual([
      expect.objectContaining({
        captureId: created.captureId,
        status: "draft"
      })
    ]);
    expect(
      (await services.listCaptures(scope))[0]?.archivedAt
    ).toBeUndefined();
  });

  it("refuses archived capture saves", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Archived source.")
    });

    await services.setCaptureArchived({
      ...scope,
      captureId: created.captureId,
      archived: true
    });
    await expect(
      services.saveCaptureDocument({
        ...scope,
        captureId: created.captureId,
        expectedWorkingVersion: 2,
        document: documentWith("Should not apply.", "block-archived")
      })
    ).rejects.toBeInstanceOf(CaptureArchivedMutationError);
  });

  it("uses non-disclosing not-found errors and rejects archived project mutation", async () => {
    const { services, projects } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });

    await expect(
      services.getCapture({
        accountId: OTHER_ACCOUNT_ID,
        projectId: BELLWETHER_FIXTURE_PROJECT_ID,
        captureId: created.captureId
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);

    await expect(
      services.getCapture({
        ...scope,
        captureId: captureId("capture-missing")
      })
    ).rejects.toBeInstanceOf(CaptureNotFoundError);

    const records = await loadProjectRecords(projects, BELLWETHER_FIXTURE_PROJECT_ID);
    expect(records).toBeDefined();
    await projects.transaction((writer) => {
      writer.replaceProjectRecords(
        {
          ...records!,
          project: {
            ...records!.project,
            version: records!.project.version + 1,
            archivedAt: "2026-07-12T17:00:00.000Z"
          }
        },
        records!.project.version
      );
    });

    await expect(
      services.createCapture({
        ...scope,
        sourceModality: "text"
      })
    ).rejects.toBeInstanceOf(ProjectArchivedMutationError);
  });

  it("omits untouched empty genesis captures even when archived filtering is enabled", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });

    expect(await services.listCaptures(scope)).toEqual([]);
    expect(await services.listCaptures({ ...scope, includeArchived: true })).toEqual(
      []
    );

    await services.setCaptureArchived({
      ...scope,
      captureId: created.captureId,
      archived: true
    });
    expect(await services.listCaptures({ ...scope, includeArchived: true })).toEqual(
      []
    );
  });

  it("serializes memory writes so concurrent stale saves apply nothing", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID
    };
    const created = await services.createCapture({
      ...scope,
      sourceModality: "text"
    });
    await services.saveCaptureDocument({
      ...scope,
      captureId: created.captureId,
      expectedWorkingVersion: 1,
      document: documentWith("Baseline.")
    });

    const outcomes = await Promise.allSettled([
      services.saveCaptureDocument({
        ...scope,
        captureId: created.captureId,
        expectedWorkingVersion: 2,
        document: documentWith("Winner.", "block-win")
      }),
      services.saveCaptureDocument({
        ...scope,
        captureId: created.captureId,
        expectedWorkingVersion: 2,
        document: documentWith("Loser.", "block-lose")
      })
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof services.saveCaptureDocument>>> =>
        outcome.status === "fulfilled"
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(CaptureVersionConflictError);

    const head = await services.getCapture({ ...scope, captureId: created.captureId });
    expect(head.workingVersion).toBe(3);
    expect(await hashSceneDocument(head.document)).toBe(
      await hashSceneDocument(fulfilled[0]!.value.document)
    );
  });
});
