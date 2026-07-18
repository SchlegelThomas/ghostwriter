import { describe, expect, it } from "vitest";
import {
  BELLWETHER_FIXTURE,
  BELLWETHER_FIXTURE_PROJECT_ID
} from "./fixtures.js";
import { accountId, createProjectMembership } from "./identity.js";
import { createMemoryProjectRepository } from "./memory-project-repository.js";
import { createMemorySceneDocumentRepository } from "./memory-scene-document-repository.js";
import { createSceneWritingServices } from "./scene-writing-services.js";
import {
  InvalidSceneDocumentError,
  InvalidSceneVariantNameError,
  SceneLeaseConflictError,
  SceneLeaseExpiredError,
  SceneNotFoundError,
  SceneVariantNameConflictError,
  SceneWorkingVersionConflictError
} from "./scene-documents.js";
import { projectId, revisionId, sceneId } from "./domain.js";

const OWNER_ACCOUNT_ID = accountId("account-scene-owner");
const OTHER_ACCOUNT_ID = accountId("account-scene-other");
const SCENE_ID = sceneId("scene-arrival-at-bellwether");

function setup() {
  let now = "2026-07-12T18:00:00.000Z";
  let nextId = 0;
  const sceneDocuments = createMemorySceneDocumentRepository();
  const services = createSceneWritingServices({
    projects: createMemoryProjectRepository(
      [BELLWETHER_FIXTURE],
      [
        createProjectMembership({
          projectId: BELLWETHER_FIXTURE_PROJECT_ID,
          accountId: OWNER_ACCOUNT_ID,
          role: "owner",
          createdAt: now
        })
      ]
    ),
    sceneDocuments,
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
    sceneDocuments,
    setNow(value: string) {
      now = value;
    }
  };
}

function changedDocument(blockId = "block-changed") {
  return documentWith("Changed prose stays private.", blockId);
}

function documentWith(text: string, blockId = "block-changed") {
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

describe("scene writing services with memory storage", () => {
  it("idempotently initializes one empty head and genesis revision", async () => {
    const { services, sceneDocuments } = setup();
    const input = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };

    const [first, second] = await Promise.all([
      services.getSceneWorkspace(input),
      services.getSceneWorkspace(input)
    ]);

    expect(first.head).toEqual(second.head);
    expect(first.head).toMatchObject({
      sceneId: SCENE_ID,
      workingVersion: 1,
      document: { schemaVersion: 1 }
    });
    const genesis = await sceneDocuments.getRevision(
      first.head.checkpointRevisionId
    );
    expect(genesis).toMatchObject({
      sceneId: SCENE_ID,
      reason: "genesis",
      origin: "system",
      actorAccountId: OWNER_ACCOUNT_ID
    });
  });

  it("saves and reloads only from the expected version under an active lease", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.getSceneWorkspace(scope);
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });

    const saved = await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 1,
      document: changedDocument()
    });
    expect(saved).toMatchObject({
      workingVersion: 2,
      document: changedDocument()
    });

    await expect(
      services.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 1,
        document: changedDocument("block-stale")
      })
    ).rejects.toBeInstanceOf(SceneWorkingVersionConflictError);
    await expect(services.getSceneWorkspace(scope)).resolves.toMatchObject({
      head: {
        workingVersion: 2,
        document: changedDocument()
      }
    });
  });

  it("refuses another session and an expired holder without applying prose", async () => {
    const { services, setNow } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });
    await expect(
      services.acquireOrRenewSceneLease({
        ...scope,
        sessionId: "session-two"
      })
    ).rejects.toBeInstanceOf(SceneLeaseConflictError);
    await expect(
      services.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-two",
        expectedWorkingVersion: 1,
        document: changedDocument("block-wrong-session")
      })
    ).rejects.toBeInstanceOf(SceneLeaseConflictError);

    setNow("2026-07-12T18:01:00.001Z");
    await expect(
      services.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 1,
        document: changedDocument("block-expired")
      })
    ).rejects.toBeInstanceOf(SceneLeaseExpiredError);
    await expect(services.getSceneWorkspace(scope)).resolves.toMatchObject({
      head: { workingVersion: 1 }
    });
  });

  it("deduplicates the checkpoint head and appends one-parent checkpoints", async () => {
    const { services, sceneDocuments } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });

    const genesisCheckpoint = await services.createManualCheckpoint({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 1
    });
    expect(genesisCheckpoint).toMatchObject({
      created: false,
      head: { workingVersion: 1 },
      revision: { reason: "genesis" }
    });

    await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 1,
      document: documentWith("A checkpointed sentence.")
    });
    const checkpoint = await services.createManualCheckpoint({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 2
    });
    expect(checkpoint).toMatchObject({
      created: true,
      head: { workingVersion: 3 },
      revision: {
        parentRevisionId: genesisCheckpoint.revision.id,
        actorAccountId: OWNER_ACCOUNT_ID,
        origin: "human",
        reason: "checkpoint"
      }
    });

    const duplicate = await services.createManualCheckpoint({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 3
    });
    expect(duplicate).toMatchObject({
      created: false,
      head: { workingVersion: 3 },
      revision: { id: checkpoint.revision.id }
    });
    expect(await sceneDocuments.listRevisions(SCENE_ID)).toHaveLength(2);
  });

  it("creates unique named variants, compares checkpoint inputs, and lists metadata", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });
    await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 1,
      document: documentWith("The first path.", "block-path")
    });
    const first = await services.createNamedSceneVariant({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 2,
      name: "  First path  "
    });
    expect(first).toMatchObject({
      checkpointCreated: true,
      head: { workingVersion: 3 },
      variant: { name: "First path" }
    });
    expect(first.variant.revisionId).toBe(first.revision.id);

    await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 3,
      document: documentWith("The second path.", "block-path")
    });
    const second = await services.createNamedSceneVariant({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 4,
      name: "Second path"
    });

    await expect(
      services.createNamedSceneVariant({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 5,
        name: " Second path "
      })
    ).rejects.toBeInstanceOf(SceneVariantNameConflictError);
    await expect(
      services.createNamedSceneVariant({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 5,
        name: "   "
      })
    ).rejects.toBeInstanceOf(InvalidSceneVariantNameError);
    await expect(services.listNamedSceneVariants(scope)).resolves.toHaveLength(2);

    const revisions = await services.listSceneRevisions(scope);
    expect(revisions).toHaveLength(3);
    expect(revisions[0]).not.toHaveProperty("document");
    await expect(
      services.compareSceneRevisions({
        ...scope,
        beforeRevisionId: first.revision.id,
        afterRevisionId: second.revision.id
      })
    ).resolves.toMatchObject({
      beforeRevision: { id: first.revision.id },
      afterRevision: { id: second.revision.id },
      comparison: {
        equal: false,
        blocks: [
          {
            blockId: "block-path",
            changes: ["changed"],
            before: { content: [{ text: "The first path." }] },
            after: { content: [{ text: "The second path." }] }
          }
        ]
      }
    });
    await expect(
      services.compareSceneRevisions({
        ...scope,
        beforeRevisionId: first.revision.id,
        afterRevisionId: revisionId("revision-missing")
      })
    ).rejects.toMatchObject({ name: "SceneRevisionNotFoundError" });
    const otherScene = await services.getSceneWorkspace({
      ...scope,
      sceneId: sceneId("scene-dead-frequency")
    });
    await expect(
      services.compareSceneRevisions({
        ...scope,
        beforeRevisionId: first.revision.id,
        afterRevisionId: otherScene.head.checkpointRevisionId
      })
    ).rejects.toMatchObject({ name: "SceneRevisionNotFoundError" });
  });

  it("restores as a new duplicate-hash revision and rolls back conflicts", async () => {
    const { services, sceneDocuments } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });
    await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 1,
      document: documentWith("Keep this version.", "block-restore")
    });
    const kept = await services.createManualCheckpoint({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 2
    });
    await services.saveWorkingSceneDocument({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 3,
      document: documentWith("Replace this version.", "block-restore")
    });
    const replaced = await services.createManualCheckpoint({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 4
    });

    const restored = await services.restoreSceneRevision({
      ...scope,
      sessionId: "session-one",
      expectedWorkingVersion: 5,
      revisionId: kept.revision.id
    });
    expect(restored).toMatchObject({
      head: {
        workingVersion: 6,
        contentHash: kept.revision.contentHash,
        checkpointRevisionId: restored.revision.id,
        document: documentWith("Keep this version.", "block-restore")
      },
      revision: {
        parentRevisionId: replaced.revision.id,
        contentHash: kept.revision.contentHash,
        actorAccountId: OWNER_ACCOUNT_ID,
        origin: "human",
        reason: "restore"
      }
    });
    expect(restored.revision.id).not.toBe(kept.revision.id);

    const revisionCount = (await sceneDocuments.listRevisions(SCENE_ID)).length;
    await expect(
      services.restoreSceneRevision({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 5,
        revisionId: kept.revision.id
      })
    ).rejects.toBeInstanceOf(SceneWorkingVersionConflictError);
    await expect(
      services.createManualCheckpoint({
        ...scope,
        sessionId: "session-other",
        expectedWorkingVersion: 6
      })
    ).rejects.toBeInstanceOf(SceneLeaseConflictError);
    expect(await sceneDocuments.listRevisions(SCENE_ID)).toHaveLength(
      revisionCount
    );
    await expect(services.getSceneWorkspace(scope)).resolves.toMatchObject({
      head: {
        workingVersion: 6,
        checkpointRevisionId: restored.revision.id
      }
    });
  });

  it("validates documents and hides missing or unauthorized scene access", async () => {
    const { services } = setup();
    const scope = {
      accountId: OWNER_ACCOUNT_ID,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      sceneId: SCENE_ID
    };
    await services.acquireOrRenewSceneLease({
      ...scope,
      sessionId: "session-one"
    });
    await expect(
      services.saveWorkingSceneDocument({
        ...scope,
        sessionId: "session-one",
        expectedWorkingVersion: 1,
        document: { schemaVersion: 1, document: { type: "doc", content: [] } }
      })
    ).rejects.toBeInstanceOf(InvalidSceneDocumentError);
    await expect(
      services.getSceneWorkspace({
        ...scope,
        accountId: OTHER_ACCOUNT_ID
      })
    ).rejects.toBeInstanceOf(SceneNotFoundError);
    await expect(
      services.getSceneWorkspace({
        ...scope,
        sceneId: sceneId("scene-missing")
      })
    ).rejects.toBeInstanceOf(SceneNotFoundError);
    await expect(
      services.getSceneWorkspace({
        ...scope,
        projectId: projectId("project-other")
      })
    ).rejects.toBeInstanceOf(SceneNotFoundError);
  });
});
