import { describe, expect, it } from "vitest";
import { validateSceneDocumentV1 } from "@ghostwriter/editor";
import { accountId } from "./identity.js";
import { projectId, revisionId, sceneId } from "./domain.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import {
  createSceneDocumentHead,
  createSceneRevision,
  sceneContentHash,
  sceneLeaseHolderId
} from "./scene-documents.js";

const PROJECT_ID = projectId("project-agent-scene-apply");
const SCENE_ID = sceneId("scene-agent-scene-apply");
const ACCOUNT_ID = accountId("account-agent-scene-apply");
const HOLDER_ID = sceneLeaseHolderId("lease-agent-scene-apply");
const GENESIS_ID = revisionId("revision-agent-scene-genesis");
const GENESIS_HASH = sceneContentHash("a".repeat(64));
const NOW = "2026-09-13T14:00:00.000Z";

function documentWith(text: string, id: string) {
  return validateSceneDocumentV1({
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id },
          content: [{ type: "text", text }]
        }
      ]
    }
  });
}

async function setup() {
  const repository = createMemorySceneDocumentRepository();
  const document = documentWith("Original scene", "paragraph-original");
  const genesis = createSceneRevision({
    id: GENESIS_ID,
    sceneId: SCENE_ID,
    projectId: PROJECT_ID,
    document,
    contentHash: GENESIS_HASH,
    actorAccountId: ACCOUNT_ID,
    origin: "human",
    reason: "genesis",
    createdAt: NOW
  });
  await repository.initialize({
    genesisRevision: genesis,
    head: createSceneDocumentHead({
      sceneId: SCENE_ID,
      projectId: PROJECT_ID,
      workingVersion: 1,
      document,
      contentHash: GENESIS_HASH,
      checkpointRevisionId: GENESIS_ID,
      updatedByAccountId: ACCOUNT_ID,
      createdAt: NOW,
      updatedAt: NOW
    })
  });
  await repository.acquireOrRenewLease({
    projectId: PROJECT_ID,
    sceneId: SCENE_ID,
    holderId: HOLDER_ID,
    now: NOW,
    expiresAt: "2026-09-13T14:05:00.000Z"
  });
  return repository;
}

describe("memory scene document agent revision apply", () => {
  it("atomically advances the working head while retaining its immutable parent", async () => {
    const repository = await setup();
    const appliedDocument = documentWith("Reviewed agent prose", "paragraph-applied");
    const appliedHash = sceneContentHash("b".repeat(64));
    const appliedId = revisionId("revision-agent-scene-applied");

    const result = await repository.applyDocumentAsRevision({
      projectId: PROJECT_ID,
      sceneId: SCENE_ID,
      holderId: HOLDER_ID,
      expectedWorkingVersion: 1,
      actorAccountId: ACCOUNT_ID,
      now: "2026-09-13T14:01:00.000Z",
      revisionId: appliedId,
      document: appliedDocument,
      contentHash: appliedHash
    });

    expect(result).toMatchObject({
      ok: true,
      head: {
        workingVersion: 2,
        document: appliedDocument,
        contentHash: appliedHash,
        checkpointRevisionId: appliedId
      },
      revision: {
        id: appliedId,
        parentRevisionId: GENESIS_ID,
        origin: "agent",
        reason: "agent-apply"
      }
    });
    expect(await repository.getRevision(GENESIS_ID)).toMatchObject({
      document: documentWith("Original scene", "paragraph-original"),
      contentHash: GENESIS_HASH
    });
    expect(await repository.listRevisions(SCENE_ID)).toHaveLength(2);

    await expect(
      repository.applyDocumentAsRevision({
        projectId: PROJECT_ID,
        sceneId: SCENE_ID,
        holderId: HOLDER_ID,
        expectedWorkingVersion: 2,
        actorAccountId: ACCOUNT_ID,
        now: "2026-09-13T14:02:00.000Z",
        revisionId: appliedId,
        document: documentWith("Must roll back", "paragraph-rollback"),
        contentHash: sceneContentHash("c".repeat(64))
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_ID" });
    expect(await repository.getHead(SCENE_ID)).toMatchObject({
      workingVersion: 2,
      document: appliedDocument,
      checkpointRevisionId: appliedId
    });
    expect(await repository.listRevisions(SCENE_ID)).toHaveLength(2);
  });

  it("refuses stale versions and missing or expired lease ownership without mutation", async () => {
    const repository = await setup();
    const base = {
      projectId: PROJECT_ID,
      sceneId: SCENE_ID,
      actorAccountId: ACCOUNT_ID,
      revisionId: revisionId("revision-refused-agent-apply"),
      document: documentWith("Refused", "paragraph-refused"),
      contentHash: sceneContentHash("d".repeat(64))
    };

    await expect(
      repository.applyDocumentAsRevision({
        ...base,
        holderId: HOLDER_ID,
        expectedWorkingVersion: 2,
        now: "2026-09-13T14:01:00.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "working-version-conflict" });
    await expect(
      repository.applyDocumentAsRevision({
        ...base,
        holderId: sceneLeaseHolderId("different-holder"),
        expectedWorkingVersion: 1,
        now: "2026-09-13T14:01:00.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "lease-conflict" });
    await expect(
      repository.applyDocumentAsRevision({
        ...base,
        holderId: HOLDER_ID,
        expectedWorkingVersion: 1,
        now: "2026-09-13T14:05:00.000Z"
      })
    ).resolves.toEqual({ ok: false, reason: "lease-expired" });
    expect(await repository.getHead(SCENE_ID)).toMatchObject({ workingVersion: 1 });
    expect(await repository.listRevisions(SCENE_ID)).toHaveLength(1);
  });

  it("accepts agent-apply and rejects unsupported revision classifications", () => {
    const base = {
      id: revisionId("revision-reason-validation"),
      sceneId: SCENE_ID,
      projectId: PROJECT_ID,
      document: documentWith("Classified", "paragraph-classified"),
      contentHash: GENESIS_HASH,
      actorAccountId: ACCOUNT_ID,
      createdAt: NOW
    };
    expect(
      createSceneRevision({ ...base, origin: "agent", reason: "agent-apply" })
    ).toMatchObject({ origin: "agent", reason: "agent-apply" });
    expect(() =>
      createSceneRevision({
        ...base,
        origin: "agent",
        reason: "unsupported" as "agent-apply"
      })
    ).toThrow(/reason is not supported/u);
  });
});
