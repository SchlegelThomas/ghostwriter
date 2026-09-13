import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import { projectId } from "./domain.js";
import { accountId } from "./identity.js";
import { mcpGrantId } from "./mcp-grants.js";
import { createMemoryStoryWorkCoordinationRepository } from "./memory-story-work-coordination-repository.js";
import { MEMORY_TRANSACTION_STATE } from "./memory-transaction.js";
import {
  cancelStoryWorkCoordination,
  createStoryWorkCoordination,
  storyWorkCoordinationId,
  storyWorkCoordinationRequestFingerprint,
  storyWorkCoordinationStepId,
  type StoryWorkCoordination
} from "./story-work-coordination.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";

const OWNER = accountId("account-coordination-memory");
const STRANGER = accountId("account-coordination-stranger");
const PROJECT = projectId("project-coordination-memory");
const OTHER_PROJECT = projectId("project-coordination-other");

function fingerprint(character: string) {
  return instructionContentHash(character.repeat(64));
}

function coordination(index = 1): StoryWorkCoordination {
  return createStoryWorkCoordination({
    id: storyWorkCoordinationId(`coordination-${index}`),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    title: `Coordination ${index}`,
    status: "active",
    steps: [
      {
        kind: "scene-draft",
        stepId: storyWorkCoordinationStepId(`coord-step-scene-${index}`),
        title: "Draft scene",
        assignmentId: storyWorkAssignmentId(`assignment-scene-${index}`)
      },
      {
        kind: "proposal-continuity-check",
        stepId: storyWorkCoordinationStepId(`coord-step-check-${index}`),
        title: "Continuity check",
        dependencies: [
          {
            stepId: storyWorkCoordinationStepId(`coord-step-scene-${index}`),
            requiredState: "artifact-ready"
          }
        ],
        deferred: {
          brief: "Check continuity.",
          constraints: "Use supplied context.",
          doneWhen: "Findings ready.",
          model: "gpt-4.1" as AgentModelId
        }
      }
    ],
    idempotencyKey: `coordination-create-${index}`,
    createdAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString()
  });
}

describe("memory story work coordination repository", () => {
  it("replays only the same scoped idempotent request fingerprint", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const original = coordination();
    const requestFingerprint = fingerprint("a");

    await expect(
      repository.create({ coordination: original, requestFingerprint })
    ).resolves.toMatchObject({ ok: true, created: true });
    await expect(
      repository.getByIdempotencyKey({
        accountId: OWNER,
        projectId: PROJECT,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toEqual({ coordination: original, requestFingerprint });
    await expect(
      repository.create({
        coordination: createStoryWorkCoordination({
          ...original,
          id: storyWorkCoordinationId("coordination-replay-candidate")
        }),
        requestFingerprint
      })
    ).resolves.toMatchObject({
      ok: true,
      created: false,
      coordination: { id: original.id }
    });
    await expect(
      repository.create({
        coordination: original,
        requestFingerprint: fingerprint("b")
      })
    ).resolves.toEqual({ ok: false, reason: "idempotency-conflict" });
  });

  it("does not disclose coordinations across account or project scopes", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const original = coordination();
    await repository.create({
      coordination: original,
      requestFingerprint: fingerprint("c")
    });

    await expect(
      repository.get({
        accountId: STRANGER,
        projectId: PROJECT,
        coordinationId: original.id
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.getByIdempotencyKey({
        accountId: STRANGER,
        projectId: PROJECT,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.getByIdempotencyKey({
        accountId: OWNER,
        projectId: OTHER_PROJECT,
        idempotencyKey: original.idempotencyKey
      })
    ).resolves.toBeUndefined();
  });

  it("compare-and-set permits cancel and refuses binding or definition mutation", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const original = coordination();
    await repository.create({
      coordination: original,
      requestFingerprint: fingerprint("d")
    });

    const canceled = cancelStoryWorkCoordination({
      coordination: original,
      expectedVersion: 1,
      updatedAt: "2026-09-13T12:10:00.000Z"
    });
    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 1,
        next: canceled
      })
    ).resolves.toMatchObject({ ok: true, coordination: { status: "canceled", version: 2 } });

    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 1,
        next: createStoryWorkCoordination({
          ...original,
          title: "Changed title",
          version: 2,
          updatedAt: "2026-09-13T12:11:00.000Z"
        })
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });

    await expect(
      repository.compareAndSet({
        accountId: STRANGER,
        projectId: PROJECT,
        coordinationId: original.id,
        expectedVersion: 2,
        next: canceled
      })
    ).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("serializes writes and restores snapshots for transactional rollback", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const state = repository[MEMORY_TRANSACTION_STATE]!;
    const snapshot = state.snapshot();
    const original = coordination(2);
    await repository.create({
      coordination: original,
      requestFingerprint: storyWorkCoordinationRequestFingerprint(fingerprint("e"))
    });
    state.restore(snapshot);
    await expect(
      repository.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: original.id
      })
    ).resolves.toBeUndefined();
  });

  it("lists project coordinations newest first with bounded limits", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    await repository.create({
      coordination: coordination(1),
      requestFingerprint: fingerprint("f")
    });
    await repository.create({
      coordination: coordination(2),
      requestFingerprint: fingerprint("b")
    });
    const listed = await repository.listByProject({
      accountId: OWNER,
      projectId: PROJECT,
      options: { limit: 1 }
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(storyWorkCoordinationId("coordination-2"));
  });

  it("roundtrips MCP origin and rejects origin mutation on compare-and-set", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const withOrigin = createStoryWorkCoordination({
      ...coordination(3),
      origin: { kind: "mcp", grantId: mcpGrantId("grant-coordination-origin") }
    });
    await repository.create({
      coordination: withOrigin,
      requestFingerprint: fingerprint("b")
    });
    await expect(
      repository.get({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: withOrigin.id
      })
    ).resolves.toMatchObject({
      origin: { kind: "mcp", grantId: mcpGrantId("grant-coordination-origin") }
    });

    const canceled = cancelStoryWorkCoordination({
      coordination: withOrigin,
      expectedVersion: 1,
      updatedAt: new Date(Date.UTC(2026, 8, 13, 12, 1, 3)).toISOString()
    });
    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        coordinationId: withOrigin.id,
        expectedVersion: 1,
        next: createStoryWorkCoordination({
          ...canceled,
          origin: { kind: "mcp", grantId: mcpGrantId("grant-other") }
        })
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
  });

  it("lists MCP grant origin rows without project-page truncation and empty cross-scope", async () => {
    const repository = createMemoryStoryWorkCoordinationRepository();
    const grant = mcpGrantId("grant-coordination-origin-list");
    const otherGrant = mcpGrantId("grant-coordination-origin-list-other");
    const oldOriginId = storyWorkCoordinationId("coordination-origin-old");
    const oldOrigin = createStoryWorkCoordination({
      ...coordination(1),
      id: oldOriginId,
      idempotencyKey: "coord-origin-old",
      origin: { kind: "mcp", grantId: grant },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repository.create({
      coordination: oldOrigin,
      requestFingerprint: fingerprint("a")
    });
    for (let index = 2; index <= 152; index += 1) {
      await repository.create({
        coordination: createStoryWorkCoordination({
          ...coordination(index),
          id: storyWorkCoordinationId(`coordination-noise-${index}`),
          idempotencyKey: `coord-noise-${index}`,
          updatedAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString()
        }),
        requestFingerprint: fingerprint((index % 10).toString())
      });
    }
    await repository.create({
      coordination: createStoryWorkCoordination({
        ...coordination(999),
        id: storyWorkCoordinationId("coordination-origin-foreign-project"),
        projectId: OTHER_PROJECT,
        idempotencyKey: "coord-origin-foreign-project",
        origin: { kind: "mcp", grantId: grant }
      }),
      requestFingerprint: fingerprint("c")
    });
    await repository.create({
      coordination: createStoryWorkCoordination({
        ...coordination(998),
        id: storyWorkCoordinationId("coordination-origin-stranger"),
        initiatorAccountId: STRANGER,
        idempotencyKey: "coord-origin-stranger",
        origin: { kind: "mcp", grantId: grant }
      }),
      requestFingerprint: fingerprint("d")
    });
    await repository.create({
      coordination: createStoryWorkCoordination({
        ...coordination(997),
        id: storyWorkCoordinationId("coordination-origin-wrong-grant"),
        idempotencyKey: "coord-origin-wrong-grant",
        origin: { kind: "mcp", grantId: otherGrant }
      }),
      requestFingerprint: fingerprint("e")
    });

    const listed = await repository.listByMcpGrantOrigin({
      accountId: OWNER,
      projectId: PROJECT,
      originMcpGrantId: grant
    });
    expect(listed.map((row) => row.id)).toEqual([oldOriginId]);
    expect(listed.every((row) => row.initiatorAccountId === OWNER)).toBe(true);
    expect(
      listed.some(
        (row) => row.id === storyWorkCoordinationId("coordination-origin-foreign-project")
      )
    ).toBe(false);
    expect(
      listed.some(
        (row) => row.id === storyWorkCoordinationId("coordination-origin-stranger")
      )
    ).toBe(false);
    expect(
      listed.some(
        (row) => row.id === storyWorkCoordinationId("coordination-origin-wrong-grant")
      )
    ).toBe(false);
  });
});
