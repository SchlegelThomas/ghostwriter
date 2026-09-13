import {
  accountId,
  projectId,
  type CanvasPersonalViewPreference
} from "@ghostwriter/core";
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasPreferenceSaveQueue,
  type CanvasPreferenceSave
} from "./canvas-preference-save-queue.js";

const project = projectId("project-preference-queue");
const account = accountId("account-preference-queue");

function queuedSave(scopeId?: string): CanvasPreferenceSave {
  const scope = scopeId === undefined
    ? { scopeKind: "project" as const }
    : { scopeKind: "scene" as const, scopeId };
  return {
    scopeView: {
      scope,
      viewport: { x: scopeId?.length ?? 0, y: 0, zoom: 1 },
      viewMode: "spatial",
      inspectorOpen: false,
      focusToken: "surface",
      workflowLens: "outline"
    },
    lastScope: scope
  };
}

function preference(version: number): CanvasPersonalViewPreference {
  return {
    projectId: project,
    accountId: account,
    version,
    lastScope: { scopeKind: "project" },
    scopeViews: [
      {
        ...queuedSave().scopeView,
        updatedAt: "2026-09-12T20:00:00.000Z"
      }
    ],
    updatedAt: "2026-09-12T20:00:00.000Z"
  };
}

describe("Canvas preference save queue", () => {
  it("serializes saves and coalesces pending updates by scope", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstGate;
        return preference(3);
      })
      .mockResolvedValueOnce(preference(4));
    const queue = createCanvasPreferenceSaveQueue({
      initialVersion: 2,
      load: vi.fn(),
      save,
      isVersionConflict: () => false
    });

    queue.enqueue(queuedSave("scene-a"));
    queue.enqueue(queuedSave("scene-b"));
    queue.enqueue({
      ...queuedSave("scene-b"),
      scopeView: {
        ...queuedSave("scene-b").scopeView,
        viewport: { x: 99, y: 0, zoom: 1 }
      }
    });
    expect(save).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await queue.whenIdle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]?.[0].expectedPreferenceVersion).toBe(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      expectedPreferenceVersion: 3,
      scopeView: { viewport: { x: 99, y: 0, zoom: 1 } }
    });
  });

  it("reloads and rebases once after a version conflict", async () => {
    const conflict = new Error("stale");
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(preference(8));
    const load = vi.fn().mockResolvedValue(preference(7));
    const onRebase = vi.fn();
    const queue = createCanvasPreferenceSaveQueue({
      initialVersion: 5,
      load,
      save,
      isVersionConflict: (cause) => cause === conflict,
      onRebase
    });

    queue.enqueue(queuedSave());
    await queue.whenIdle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(onRebase).toHaveBeenCalledWith(preference(7));
    expect(save.mock.calls.map((call) => call[0].expectedPreferenceVersion)).toEqual([
      5,
      7
    ]);
  });

  it("bounds conflict recovery to one reload and reports the second conflict", async () => {
    const conflict = new Error("stale");
    const onError = vi.fn();
    const queue = createCanvasPreferenceSaveQueue({
      initialVersion: 1,
      load: vi.fn().mockResolvedValue(preference(2)),
      save: vi.fn().mockRejectedValue(conflict),
      isVersionConflict: (cause) => cause === conflict,
      onError
    });
    queue.enqueue(queuedSave());
    await queue.whenIdle();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("drops pending work and ignores completions after teardown", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onSaved = vi.fn();
    const save = vi.fn(async () => {
      await gate;
      return preference(2);
    });
    const queue = createCanvasPreferenceSaveQueue({
      initialVersion: 1,
      load: vi.fn(),
      save,
      isVersionConflict: () => false,
      onSaved
    });
    queue.enqueue(queuedSave("scene-a"));
    queue.enqueue(queuedSave("scene-b"));
    queue.dispose();
    release?.();
    await queue.whenIdle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
