import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSceneSaveQueue,
  type SceneSaveAcknowledgement
} from "./scene-save-queue.js";

function sceneDocument(id: string, text: string): SceneDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId(id) },
          ...(text.length === 0
            ? {}
            : { content: [{ type: "text" as const, text }] })
        }
      ]
    }
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("scene save queue", () => {
  it("debounces, serializes, and immediately follows an acknowledgement with newer edits", async () => {
    vi.useFakeTimers();
    const initial = sceneDocument("block-initial", "");
    const firstEdit = sceneDocument("block-initial", "The harbor slept.");
    const intermediateEdit = sceneDocument(
      "block-initial",
      "The harbor slept beneath fog."
    );
    const latestEdit = sceneDocument(
      "block-initial",
      "The harbor slept beneath silver fog."
    );
    const firstSave = deferred<SceneSaveAcknowledgement>();
    const secondSave = deferred<SceneSaveAcknowledgement>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      debounceMs: 900,
      save
    });

    queue.enqueue(firstEdit);
    expect(queue.getSnapshot()).toMatchObject({
      status: "pending",
      dirty: true
    });
    await vi.advanceTimersByTimeAsync(899);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, {
      expectedWorkingVersion: 1,
      document: firstEdit
    });

    queue.enqueue(intermediateEdit);
    queue.enqueue(latestEdit);
    expect(save).toHaveBeenCalledTimes(1);

    firstSave.resolve({ workingVersion: 2, document: firstEdit });
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, {
      expectedWorkingVersion: 2,
      document: latestEdit
    });

    secondSave.resolve({ workingVersion: 3, document: latestEdit });
    await queue.flush();
    expect(queue.getSnapshot()).toMatchObject({
      status: "saved",
      dirty: false,
      acknowledgedWorkingVersion: 3,
      latestDocument: latestEdit
    });
  });

  it("preserves local JSON while installing a newer conflict head for retry", async () => {
    vi.useFakeTimers();
    const initial = sceneDocument("block-conflict", "Server v1");
    const local = sceneDocument("block-conflict", "Local unsaved prose");
    const server = sceneDocument("block-conflict", "Server v4");
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("revision conflict"))
      .mockResolvedValueOnce({ workingVersion: 5, document: local });
    const queue = createSceneSaveQueue({
      initialAcknowledgement: { workingVersion: 1, document: initial },
      debounceMs: 900,
      save
    });

    queue.enqueue(local);
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.getSnapshot()).toMatchObject({
      status: "paused",
      dirty: true,
      latestDocument: local
    });

    queue.installAcknowledgement(
      { workingVersion: 4, document: server },
      true
    );
    expect(queue.getLatestDocument()).toEqual(local);
    queue.resume({ immediate: true });
    await queue.flush();

    expect(save).toHaveBeenNthCalledWith(2, {
      expectedWorkingVersion: 4,
      document: local
    });
    expect(queue.getSnapshot()).toMatchObject({
      status: "saved",
      dirty: false,
      acknowledgedWorkingVersion: 5
    });
  });
});
