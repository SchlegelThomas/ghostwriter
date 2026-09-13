import { describe, expect, it } from "vitest";
import type { AgentModelId } from "./agent-context-receipt.js";
import { instructionContentHash } from "./agent-domain.js";
import { agentRunId, projectId, storyKnowledgeId } from "./domain.js";
import { accountId } from "./identity.js";
import { createMemoryStoryWorkAssignmentRepository } from "./memory-story-work-assignment-repository.js";
import {
  createStoryWorkAssignment,
  startStoryWorkAttempt,
  storyWorkAssignmentId,
  type StoryWorkAssignment
} from "./story-work-assignment.js";

const OWNER = accountId("account-owner");
const STRANGER = accountId("account-stranger");
const PROJECT = projectId("project-assignments");
const OTHER_PROJECT = projectId("project-other");

function fingerprint(character: string) {
  return instructionContentHash(character.repeat(64));
}

function assignment(index = 1): StoryWorkAssignment {
  return createStoryWorkAssignment({
    id: storyWorkAssignmentId(`assignment-${index}`),
    projectId: PROJECT,
    initiatorAccountId: OWNER,
    version: 1,
    taskKind: "character",
    brief: `Character brief ${index}`,
    constraints: "Keep the character grounded in supplied story context.",
    doneWhen: "A character draft is ready for writer review.",
    sources: [{ kind: "project", projectId: PROJECT, projectVersion: 1 }],
    destination: {
      kind: "story-knowledge",
      storyKnowledgeId: storyKnowledgeId(`knowledge-${index}`),
      operation: "create"
    },
    provider: "openai",
    model: "gpt-4.1" as AgentModelId,
    status: "brief-ready",
    steps: [{ id: "draft", title: "Draft", dependencies: [] }],
    results: [],
    idempotencyKey: `submit-${index}`,
    createdAt: new Date(Date.UTC(2026, 8, 12, 12, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 12, 12, 0, index)).toISOString()
  });
}

describe("memory story work assignment repository", () => {
  it("replays only the same scoped idempotent request fingerprint", async () => {
    const repository = createMemoryStoryWorkAssignmentRepository();
    const original = assignment();
    const requestFingerprint = fingerprint("a");

    await expect(
      repository.create({ assignment: original, requestFingerprint })
    ).resolves.toMatchObject({ ok: true, created: true });
    await expect(
      repository.create({
        assignment: createStoryWorkAssignment({
          ...original,
          id: storyWorkAssignmentId("assignment-replayed-candidate")
        }),
        requestFingerprint
      })
    ).resolves.toMatchObject({
      ok: true,
      created: false,
      assignment: { id: original.id }
    });
    await expect(
      repository.create({
        assignment: original,
        requestFingerprint: fingerprint("b")
      })
    ).resolves.toEqual({ ok: false, reason: "idempotency-conflict" });
  });

  it("does not disclose assignments across account or project scopes", async () => {
    const repository = createMemoryStoryWorkAssignmentRepository();
    const original = assignment();
    await repository.create({
      assignment: original,
      requestFingerprint: fingerprint("c")
    });

    await expect(
      repository.get({ accountId: STRANGER, projectId: PROJECT, assignmentId: original.id })
    ).resolves.toBeUndefined();
    await expect(
      repository.get({ accountId: OWNER, projectId: OTHER_PROJECT, assignmentId: original.id })
    ).resolves.toBeUndefined();
    await expect(
      repository.listByProject({ accountId: STRANGER, projectId: PROJECT })
    ).resolves.toEqual([]);
    await expect(
      repository.compareAndSet({
        accountId: STRANGER,
        projectId: PROJECT,
        assignmentId: original.id,
        expectedVersion: 1,
        next: startStoryWorkAttempt({
          assignment: original,
          expectedVersion: 1,
          runId: agentRunId("run-hidden"),
          updatedAt: "2026-09-12T12:02:00.000Z"
        })
      })
    ).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("uses CAS without mutating saved state after a conflict", async () => {
    const repository = createMemoryStoryWorkAssignmentRepository();
    const original = assignment();
    await repository.create({
      assignment: original,
      requestFingerprint: fingerprint("d")
    });
    const running = startStoryWorkAttempt({
      assignment: original,
      expectedVersion: 1,
      runId: agentRunId("run-current"),
      updatedAt: "2026-09-12T12:02:00.000Z"
    });
    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: original.id,
        expectedVersion: 1,
        next: running
      })
    ).resolves.toMatchObject({ ok: true, assignment: { version: 2 } });

    const staleNext = startStoryWorkAttempt({
      assignment: original,
      expectedVersion: 1,
      runId: agentRunId("run-stale"),
      updatedAt: "2026-09-12T12:03:00.000Z"
    });
    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: original.id,
        expectedVersion: 1,
        next: staleNext
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });

    const rewrittenBrief = createStoryWorkAssignment({
      ...running,
      version: 3,
      brief: "A silently replaced brief",
      updatedAt: "2026-09-12T12:04:00.000Z"
    });
    await expect(
      repository.compareAndSet({
        accountId: OWNER,
        projectId: PROJECT,
        assignmentId: original.id,
        expectedVersion: 2,
        next: rewrittenBrief
      })
    ).resolves.toEqual({ ok: false, reason: "version-conflict" });
    await expect(
      repository.get({ accountId: OWNER, projectId: PROJECT, assignmentId: original.id })
    ).resolves.toMatchObject({
      version: 2,
      status: "running",
      activeAttemptId: agentRunId("run-current")
    });
  });

  it("keeps project listings bounded and ordered without cross-project rows", async () => {
    const repository = createMemoryStoryWorkAssignmentRepository();
    for (let index = 1; index <= 105; index += 1) {
      const next = assignment(index);
      const outcome = await repository.create({
        assignment: next,
        requestFingerprint: fingerprint((index % 10).toString())
      });
      expect(outcome.ok).toBe(true);
    }

    const defaultPage = await repository.listByProject({
      accountId: OWNER,
      projectId: PROJECT
    });
    const shortPage = await repository.listByProject({
      accountId: OWNER,
      projectId: PROJECT,
      options: { limit: 2 }
    });
    expect(defaultPage).toHaveLength(100);
    expect(shortPage.map((item) => item.id)).toEqual([
      storyWorkAssignmentId("assignment-105"),
      storyWorkAssignmentId("assignment-104")
    ]);
  });
});
