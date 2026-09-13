import { describe, expect, it } from "vitest";
import { instructionContentHash } from "./agent-domain.js";
import { agentProposalId, agentRunId, projectId } from "./domain.js";
import { accountId } from "./identity.js";
import { createMemoryStoryWorkAttemptRepository } from "./memory-story-work-attempt-repository.js";
import { storyWorkAssignmentId } from "./story-work-assignment.js";
import {
  completeStoryWorkAttempt,
  createStoryWorkAttempt,
  StoryWorkAttemptTransitionError
} from "./story-work-attempt.js";

const ASSIGNMENT_ID = storyWorkAssignmentId("assignment-character-mara");
const PROJECT_ID = projectId("project-story-work-attempt");
const ACCOUNT_ID = accountId("account-story-work-attempt");
const RUN_ID = agentRunId("run-story-work-attempt-1");

function pendingInitial() {
  return createStoryWorkAttempt({
    assignmentId: ASSIGNMENT_ID,
    projectId: PROJECT_ID,
    initiatorAccountId: ACCOUNT_ID,
    runId: RUN_ID,
    version: 1,
    kind: "initial",
    sourceMode: "submitted-snapshot",
    instruction: "  Keep Mara wary of the signal.  ",
    idempotencyKey: "character-attempt-1",
    requestFingerprint: instructionContentHash("1".repeat(64)),
    createdAt: "2026-09-12T12:00:00.000Z"
  });
}

describe("story work attempts", () => {
  it("preserves the exact submitted instruction and advances one immutable result", () => {
    const initial = pendingInitial();
    expect(initial.instruction).toBe("  Keep Mara wary of the signal.  ");

    const completed = completeStoryWorkAttempt({
      attempt: initial,
      expectedVersion: 1,
      resultArtifact: {
        proposalId: agentProposalId("proposal-character-mara-v1"),
        artifactVersion: 1,
        contentHash: instructionContentHash("a".repeat(64))
      },
      completedAt: "2026-09-12T12:01:00.000Z"
    });

    expect(completed).toMatchObject({ version: 2, completedAt: "2026-09-12T12:01:00.000Z" });
    expect(() =>
      completeStoryWorkAttempt({
        attempt: completed,
        expectedVersion: 2,
        resultArtifact: {
          proposalId: agentProposalId("proposal-character-mara-v2"),
          artifactVersion: 2,
          contentHash: instructionContentHash("b".repeat(64))
        },
        completedAt: "2026-09-12T12:02:00.000Z"
      })
    ).toThrow(StoryWorkAttemptTransitionError);
  });

  it("requires revisions to point at the exact prior artifact", () => {
    expect(() =>
      createStoryWorkAttempt({
        ...pendingInitial(),
        runId: agentRunId("run-story-work-attempt-2"),
        kind: "revision",
        sourceMode: "latest-authorized"
      })
    ).toThrow(/prior reviewed artifact/i);

    const revision = createStoryWorkAttempt({
      ...pendingInitial(),
      runId: agentRunId("run-story-work-attempt-2"),
      kind: "revision",
      sourceMode: "latest-authorized",
      instruction: "Make the voice more guarded.",
      priorArtifact: {
        proposalId: agentProposalId("proposal-character-mara-v1"),
        artifactVersion: 1,
        contentHash: instructionContentHash("a".repeat(64))
      }
    });
    expect(revision.priorArtifact?.artifactVersion).toBe(1);
    expect(() =>
      completeStoryWorkAttempt({
        attempt: revision,
        expectedVersion: 1,
        resultArtifact: revision.priorArtifact!,
        completedAt: "2026-09-12T12:01:00.000Z"
      })
    ).toThrow(StoryWorkAttemptTransitionError);
  });

  it("requires submitted snapshots for initial work and explicit latest sources for revisions", () => {
    expect(() =>
      createStoryWorkAttempt({
        ...pendingInitial(),
        sourceMode: "latest-authorized"
      })
    ).toThrow(/initial work requires submitted sources/i);
    expect(() =>
      createStoryWorkAttempt({
        ...pendingInitial(),
        runId: agentRunId("run-story-work-attempt-refresh"),
        kind: "revision",
        sourceMode: "submitted-snapshot",
        instruction: "Revise from the latest saved sources.",
        priorArtifact: {
          proposalId: agentProposalId("proposal-character-mara-v1"),
          artifactVersion: 1,
          contentHash: instructionContentHash("a".repeat(64))
        }
      })
    ).toThrow(/revisions require an explicit latest-source refresh/i);
  });

  it("scopes repository reads and protects immutable attempt authorship", async () => {
    const repository = createMemoryStoryWorkAttemptRepository();
    const created = await repository.create({ attempt: pendingInitial() });
    expect(created).toMatchObject({ ok: true, created: true });
    expect(
      await repository.create({
        attempt: { ...pendingInitial(), runId: agentRunId("ignored-replay-run") }
      })
    ).toMatchObject({ ok: true, created: false, attempt: { runId: RUN_ID } });
    expect(
      await repository.create({
        attempt: {
          ...pendingInitial(),
          runId: agentRunId("conflicting-replay-run"),
          requestFingerprint: instructionContentHash("2".repeat(64))
        }
      })
    ).toEqual({ ok: false, reason: "idempotency-conflict" });
    expect(
      await repository.get({
        accountId: accountId("account-foreign"),
        projectId: PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        runId: RUN_ID
      })
    ).toBeUndefined();

    const changed = createStoryWorkAttempt({
      ...pendingInitial(),
      version: 2,
      instruction: "A rewritten instruction",
      resultArtifact: {
        proposalId: agentProposalId("proposal-character-mara-v1"),
        artifactVersion: 1,
        contentHash: instructionContentHash("a".repeat(64))
      },
      completedAt: "2026-09-12T12:01:00.000Z"
    });
    expect(
      await repository.compareAndSet({
        accountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        assignmentId: ASSIGNMENT_ID,
        runId: RUN_ID,
        expectedVersion: 1,
        next: changed
      })
    ).toEqual({ ok: false, reason: "version-conflict" });
  });
});
