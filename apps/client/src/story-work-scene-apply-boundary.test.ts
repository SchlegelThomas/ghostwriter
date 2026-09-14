import type { StoryWorkAssignment } from "@ghostwriter/core";
import { describe, expect, it, vi } from "vitest";
import {
  inferSceneStoryWorkAppliedMode,
  isSceneStoryWorkUpdateApplyMode,
  refuseCreateSceneCanvasWhenRequested,
  resolveSceneStoryWorkAppliedMode,
  resolveSceneStoryWorkApplyIdempotencyKey,
  runSceneStoryWorkUpdateApply,
  sceneStoryWorkApplySemanticFingerprint
} from "./story-work-scene-apply-boundary.js";

function appliedSceneAssignment(overrides: Record<string, unknown>): StoryWorkAssignment {
  return overrides as unknown as StoryWorkAssignment;
}

describe("scene story-work apply boundary", () => {
  it("runs update apply as prepare, dispatch, then finish", async () => {
    const order: string[] = [];
    const outcome = await runSceneStoryWorkUpdateApply({
      prepare: async () => {
        order.push("prepare");
        return { expectedWorkingVersion: 2, expectedContentHash: "a".repeat(64) };
      },
      dispatch: async (boundary) => {
        order.push("dispatch");
        expect(boundary.expectedWorkingVersion).toBe(2);
        return { acknowledged: true };
      },
      finish: async () => {
        order.push("finish");
      }
    });
    expect(order).toEqual(["prepare", "dispatch", "finish"]);
    expect(outcome).toEqual({ kind: "success", result: { acknowledged: true } });
  });

  it("still finishes Draft after a dispatched apply refusal", async () => {
    const finish = vi.fn(async () => undefined);
    const refusal = new Error("working-version-conflict");
    const outcome = await runSceneStoryWorkUpdateApply({
      prepare: async () => ({ expectedWorkingVersion: 1, expectedContentHash: "b".repeat(64) }),
      dispatch: async () => {
        throw refusal;
      },
      finish
    });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "dispatch-failed", error: refusal });
  });

  it("does not dispatch or finish when prepare refuses", async () => {
    const dispatch = vi.fn();
    const finish = vi.fn();
    const prepareError = new Error("draft-dirty");
    const outcome = await runSceneStoryWorkUpdateApply({
      prepare: async () => {
        throw prepareError;
      },
      dispatch,
      finish
    });
    expect(outcome).toEqual({ kind: "prepare-refused", error: prepareError });
    expect(dispatch).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("returns acknowledged apply when finish fails after success", async () => {
    const finishError = new Error("refresh failed");
    const outcome = await runSceneStoryWorkUpdateApply({
      prepare: async () => ({ expectedWorkingVersion: 4, expectedContentHash: "c".repeat(64) }),
      dispatch: async () => ({ replayed: false, sceneId: "scene-result" }),
      finish: async () => {
        throw finishError;
      }
    });
    expect(outcome).toEqual({
      kind: "applied-finish-failed",
      result: { replayed: false, sceneId: "scene-result" },
      finishError
    });
  });

  it("preserves dispatch failure when finish also fails", async () => {
    const dispatchError = new Error("lease-conflict");
    const finishError = new Error("refresh failed");
    await expect(runSceneStoryWorkUpdateApply({
      prepare: async () => ({ expectedWorkingVersion: 1, expectedContentHash: "d".repeat(64) }),
      dispatch: async () => {
        throw dispatchError;
      },
      finish: async () => {
        throw finishError;
      }
    })).rejects.toThrow(dispatchError);
  });

  it("keeps create modes outside the Draft update boundary", () => {
    expect(isSceneStoryWorkUpdateApplyMode("create-scene")).toBe(false);
    expect(isSceneStoryWorkUpdateApplyMode("named-variant")).toBe(true);
    expect(isSceneStoryWorkUpdateApplyMode("apply-revision")).toBe(true);
  });

  it("infers create, named-variant, and apply-revision modes from applied assignments", () => {
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "scene",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-new", operation: "create" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [{ kind: "scene", sceneId: "scene-new", workingVersion: 1, revisionId: "revision-genesis" }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBe("create-scene");
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "revise",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-target", operation: "update" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [{
        kind: "scene",
        sceneId: "scene-target",
        workingVersion: 4,
        revisionId: "revision-variant",
        variantId: "variant-1"
      }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBe("named-variant");
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "revise",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-target", operation: "update" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [{ kind: "scene", sceneId: "scene-target", workingVersion: 5, revisionId: "revision-apply" }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBe("apply-revision");
  });

  it("returns undefined for malformed or non-applied scene assignments", () => {
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "scene",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-new", operation: "create" },
      provider: "openai",
      model: "gpt-4.1",
      status: "awaiting-review",
      steps: [],
      results: [{ kind: "scene", sceneId: "scene-new", workingVersion: 1, revisionId: "revision-genesis" }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBeUndefined();
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "revise",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-target", operation: "update" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [{
        kind: "scene",
        sceneId: "scene-target",
        workingVersion: 4,
        variantId: "variant-1"
      }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBeUndefined();
    expect(inferSceneStoryWorkAppliedMode(appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "revise",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-target", operation: "update" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [
        { kind: "scene", sceneId: "scene-target", workingVersion: 4, revisionId: "revision-a" },
        { kind: "scene", sceneId: "scene-other", workingVersion: 1, revisionId: "revision-b" }
      ],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    }))).toBeUndefined();
  });

  it("prefers session mode but falls back to canonical inference", () => {
    const assignment = appliedSceneAssignment({
      id: "assignment",
      projectId: "project",
      initiatorAccountId: "account",
      version: 2,
      taskKind: "revise",
      brief: "Brief",
      constraints: "Constraints",
      doneWhen: "Done",
      sources: [],
      destination: { kind: "scene", sceneId: "scene-target", operation: "update" },
      provider: "openai",
      model: "gpt-4.1",
      status: "applied",
      steps: [],
      results: [{ kind: "scene", sceneId: "scene-target", workingVersion: 5, revisionId: "revision-apply" }],
      idempotencyKey: "request",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:01:00.000Z"
    });
    expect(resolveSceneStoryWorkAppliedMode({
      assignment,
      sessionMode: "named-variant"
    })).toBe("named-variant");
    expect(resolveSceneStoryWorkAppliedMode({ assignment })).toBe("apply-revision");
  });

  it("refuses create-scene apply when Canvas placement was requested but unavailable", () => {
    expect(() => refuseCreateSceneCanvasWhenRequested({
      placeOnCurrentCanvas: true
    })).toThrow(/Canvas placement is unavailable/);
    expect(() => refuseCreateSceneCanvasWhenRequested({
      placeOnCurrentCanvas: false
    })).not.toThrow();
  });

  it("reuses idempotency keys for the same semantic apply fingerprint", () => {
    const semantic = sceneStoryWorkApplySemanticFingerprint({
      projectId: "project",
      assignmentId: "assignment",
      mode: "apply-revision",
      expectedAssignmentVersion: 2,
      proposalId: "proposal",
      expectedArtifactVersion: 1,
      expectedProposalContentHash: "e".repeat(64),
      expectedSceneWorkingVersion: 3,
      expectedSceneContentHash: "f".repeat(64)
    });
    const first = resolveSceneStoryWorkApplyIdempotencyKey({ fingerprint: semantic });
    const second = resolveSceneStoryWorkApplyIdempotencyKey({
      current: first,
      fingerprint: semantic
    });
    expect(second.key).toBe(first.key);
    expect(
      resolveSceneStoryWorkApplyIdempotencyKey({
        current: first,
        fingerprint: `${semantic}-changed`
      }).key
    ).not.toBe(first.key);
  });
});
