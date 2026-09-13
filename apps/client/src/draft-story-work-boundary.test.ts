import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it, vi } from "vitest";
import type { SceneWorkspaceResponse } from "./api.js";
import {
  DraftStoryWorkBoundaryError,
  prepareDraftStoryWorkBoundary,
  refreshDraftStoryWorkBoundary
} from "./draft-story-work-boundary.js";
import type { SceneRecoveryCoordinator } from "./scene-recovery.js";
import { createSceneSaveQueue } from "./scene-save-queue.js";

function documentWith(id: string, text: string): SceneDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId(id) },
          content: [{ type: "text", text }]
        }
      ]
    }
  };
}

function workspace(
  workingVersion: number,
  document: SceneDocumentV1
): SceneWorkspaceResponse {
  return {
    head: {
      sceneId: "scene-boundary",
      projectId: "project-boundary",
      workingVersion,
      document,
      contentHash: "a".repeat(64),
      checkpointRevisionId: `revision-${workingVersion}`,
      updatedByAccountId: "account-boundary",
      createdAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:01:00.000Z"
    },
    lease: {
      heldByCurrentSession: true,
      renewedAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2026-09-13T12:10:00.000Z"
    }
  };
}

function recovery(
  overrides: Partial<SceneRecoveryCoordinator> = {}
): SceneRecoveryCoordinator {
  return {
    capture: async () => undefined,
    acknowledge: async () => undefined,
    discard: async () => undefined,
    flush: async () => undefined,
    ...overrides
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Draft story-work boundary", () => {
  it("refuses unresolved recovery before hashing or pausing the real save queue", async () => {
    const initial = documentWith("block-initial", "Original Draft");
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      save: vi.fn()
    });
    const hashDocument = vi.fn(async () => "hash");

    await expect(
      prepareDraftStoryWorkBoundary({
        queue,
        recovery: recovery(),
        unresolvedRecovery: true,
        currentLease: () => ({
          heldByCurrentSession: true,
          renewedAt: "2026-09-13T12:00:00.000Z",
          expiresAt: "2026-09-13T12:10:00.000Z"
        }),
        isCurrent: () => true,
        now: () => Date.parse("2026-09-13T12:01:00.000Z"),
        hashDocument
      })
    ).rejects.toMatchObject({ code: "recovery-pending" });
    expect(hashDocument).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({ status: "saved", dirty: false });
  });

  it("leaves the queue paused when its lease expires during preparation", async () => {
    const initial = documentWith("block-initial", "Original Draft");
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 4, document: initial },
      save: vi.fn()
    });
    let now = Date.parse("2026-09-13T12:01:00.000Z");

    await expect(
      prepareDraftStoryWorkBoundary({
        queue,
        recovery: recovery(),
        unresolvedRecovery: false,
        currentLease: () => ({
          heldByCurrentSession: true,
          renewedAt: "2026-09-13T12:00:00.000Z",
          expiresAt: "2026-09-13T12:02:00.000Z"
        }),
        isCurrent: () => true,
        now: () => now,
        hashDocument: async () => {
          now = Date.parse("2026-09-13T12:02:00.001Z");
          return "hash";
        }
      })
    ).rejects.toMatchObject({ code: "lease-unavailable" });
    expect(queue.getSnapshot()).toMatchObject({ status: "paused", dirty: false });
  });

  it("waits for a deferred recovery capture and refuses to replace dirty local prose", async () => {
    const initial = documentWith("block-initial", "Original Draft");
    const local = documentWith("block-local", "Late local prose");
    const applied = documentWith("block-applied", "Reviewed scene prose");
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      save: vi.fn()
    });
    queue.pause();
    const pendingCapture = deferred<void>();
    const discard = vi.fn(async () => undefined);
    const boundaryRecovery = recovery({
      flush: async () => {
        await pendingCapture.promise;
        queue.enqueue(local);
      },
      discard
    });

    const finishing = refreshDraftStoryWorkBoundary({
      queue,
      recovery: boundaryRecovery,
      isCurrent: () => true,
      loadWorkspace: async () => workspace(2, applied)
    });
    await Promise.resolve();
    expect(queue.getSnapshot().dirty).toBe(false);
    pendingCapture.resolve();

    await expect(finishing).rejects.toMatchObject({ code: "draft-dirty" });
    expect(discard).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({
      status: "paused",
      dirty: true,
      acknowledgedWorkingVersion: 1,
      latestDocument: local,
      acknowledgedDocument: initial
    });
  });

  it("cancels a late scope without installing or discarding anything", async () => {
    const initial = documentWith("block-initial", "Original Draft");
    const applied = documentWith("block-applied", "Reviewed scene prose");
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      save: vi.fn()
    });
    queue.pause();
    const loaded = deferred<SceneWorkspaceResponse>();
    const discard = vi.fn(async () => undefined);
    let current = true;
    const finishing = refreshDraftStoryWorkBoundary({
      queue,
      recovery: recovery({ discard }),
      isCurrent: () => current,
      loadWorkspace: () => loaded.promise
    });
    current = false;
    loaded.resolve(workspace(2, applied));

    await expect(finishing).rejects.toBeInstanceOf(
      DraftStoryWorkBoundaryError
    );
    expect(discard).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({
      acknowledgedWorkingVersion: 1,
      acknowledgedDocument: initial
    });
  });

  it("installs an acknowledged refresh only after recovery is flushed", async () => {
    const initial = documentWith("block-initial", "Original Draft");
    const applied = documentWith("block-applied", "Reviewed scene prose");
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      save: vi.fn()
    });
    queue.pause();
    const calls: string[] = [];
    const result = await refreshDraftStoryWorkBoundary({
      queue,
      recovery: recovery({
        flush: async () => {
          calls.push("flush");
        },
        discard: async () => {
          calls.push("discard");
        }
      }),
      isCurrent: () => true,
      loadWorkspace: async () => {
        calls.push("load");
        return workspace(2, applied);
      }
    });

    expect(result.head.workingVersion).toBe(2);
    expect(calls).toEqual(["load", "flush", "discard"]);
    expect(queue.getSnapshot()).toMatchObject({
      status: "paused",
      dirty: false,
      acknowledgedWorkingVersion: 2,
      latestDocument: applied,
      acknowledgedDocument: applied
    });
  });
});
