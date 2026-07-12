import {
  serializeCanonicalSceneDocument,
  type SceneDocumentV1
} from "@ghostwriter/editor";

export type SceneSaveQueueStatus = "saved" | "pending" | "saving" | "paused";

export type SceneSaveAcknowledgement = Readonly<{
  workingVersion: number;
  document: SceneDocumentV1;
}>;

export type SceneSaveQueueSnapshot = Readonly<{
  status: SceneSaveQueueStatus;
  dirty: boolean;
  acknowledgedWorkingVersion: number;
  latestDocument: SceneDocumentV1;
  acknowledgedDocument: SceneDocumentV1;
}>;

export type SceneSaveQueue = Readonly<{
  enqueue(document: SceneDocumentV1): void;
  pause(): void;
  resume(options?: Readonly<{ immediate?: boolean }>): void;
  installAcknowledgement(
    acknowledgement: SceneSaveAcknowledgement,
    preserveLatest: boolean
  ): void;
  flush(): Promise<void>;
  dispose(): void;
  getSnapshot(): SceneSaveQueueSnapshot;
  getLatestDocument(): SceneDocumentV1;
  getAcknowledgedWorkingVersion(): number;
}>;

export type SceneSaveQueueOptions<
  Acknowledgement extends SceneSaveAcknowledgement
> = Readonly<{
  initialAcknowledgement: Acknowledgement;
  debounceMs?: number;
  startPaused?: boolean;
  save(input: Readonly<{
    expectedWorkingVersion: number;
    document: SceneDocumentV1;
  }>): Promise<Acknowledgement>;
  onAcknowledged?(acknowledgement: Acknowledgement): void;
  onError?(cause: unknown): void;
  onStateChange?(snapshot: SceneSaveQueueSnapshot): void;
}>;

const DEFAULT_DEBOUNCE_MS = 900;

function canonical(document: SceneDocumentV1): string {
  return serializeCanonicalSceneDocument(document);
}

export function createSceneSaveQueue<
  Acknowledgement extends SceneSaveAcknowledgement
>(
  options: SceneSaveQueueOptions<Acknowledgement>
): SceneSaveQueue {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
    throw new Error("Scene save debounce must be a non-negative integer.");
  }

  let acknowledgedDocument = options.initialAcknowledgement.document;
  let acknowledgedCanonical = canonical(acknowledgedDocument);
  let acknowledgedWorkingVersion =
    options.initialAcknowledgement.workingVersion;
  let latestDocument = acknowledgedDocument;
  let latestCanonical = acknowledgedCanonical;
  let status: SceneSaveQueueStatus =
    options.startPaused === true ? "paused" : "saved";
  let paused = options.startPaused === true;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  function dirty(): boolean {
    return latestCanonical !== acknowledgedCanonical;
  }

  function snapshot(): SceneSaveQueueSnapshot {
    return {
      status,
      dirty: dirty(),
      acknowledgedWorkingVersion,
      latestDocument,
      acknowledgedDocument
    };
  }

  function publish(nextStatus: SceneSaveQueueStatus): void {
    status = nextStatus;
    if (!disposed) options.onStateChange?.(snapshot());
  }

  function clearDebounce(): void {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  }

  function scheduleSave(): void {
    clearDebounce();
    if (disposed || paused) {
      publish("paused");
      return;
    }
    if (inFlight !== undefined) {
      publish("saving");
      return;
    }
    if (!dirty()) {
      publish("saved");
      return;
    }

    publish("pending");
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void startSave();
    }, debounceMs);
  }

  async function performSave(
    document: SceneDocumentV1,
    expectedWorkingVersion: number
  ): Promise<void> {
    let failed = false;
    try {
      const acknowledgement = await options.save({
        expectedWorkingVersion,
        document
      });
      acknowledgedDocument = acknowledgement.document;
      acknowledgedCanonical = canonical(acknowledgedDocument);
      acknowledgedWorkingVersion = acknowledgement.workingVersion;
      options.onAcknowledged?.(acknowledgement);
    } catch (cause) {
      failed = true;
      paused = true;
      options.onError?.(cause);
    } finally {
      inFlight = undefined;
      if (!disposed) {
        if (failed || paused) {
          publish("paused");
        } else if (dirty()) {
          publish("saving");
          void startSave();
        } else {
          publish("saved");
        }
      }
    }
  }

  function startSave(): Promise<void> {
    clearDebounce();
    if (inFlight !== undefined) return inFlight;
    if (disposed || paused || !dirty()) {
      publish(paused ? "paused" : "saved");
      return Promise.resolve();
    }

    publish("saving");
    const task = performSave(latestDocument, acknowledgedWorkingVersion);
    inFlight = task;
    return task;
  }

  const queue: SceneSaveQueue = {
    enqueue(document): void {
      if (disposed) return;
      latestDocument = document;
      latestCanonical = canonical(document);
      scheduleSave();
    },

    pause(): void {
      if (disposed) return;
      paused = true;
      clearDebounce();
      publish(inFlight === undefined ? "paused" : "saving");
    },

    resume(resumeOptions = {}): void {
      if (disposed) return;
      paused = false;
      if (!dirty()) {
        publish(inFlight === undefined ? "saved" : "saving");
      } else if (resumeOptions.immediate === true) {
        void startSave();
      } else {
        scheduleSave();
      }
    },

    installAcknowledgement(acknowledgement, preserveLatest): void {
      if (disposed) return;
      acknowledgedDocument = acknowledgement.document;
      acknowledgedCanonical = canonical(acknowledgedDocument);
      acknowledgedWorkingVersion = acknowledgement.workingVersion;
      if (!preserveLatest) {
        latestDocument = acknowledgedDocument;
        latestCanonical = acknowledgedCanonical;
      }

      if (inFlight !== undefined) {
        publish("saving");
      } else if (paused) {
        publish("paused");
      } else if (dirty()) {
        scheduleSave();
      } else {
        publish("saved");
      }
    },

    async flush(): Promise<void> {
      clearDebounce();
      while (!disposed && !paused) {
        if (inFlight !== undefined) {
          await inFlight;
          continue;
        }
        if (!dirty()) {
          publish("saved");
          return;
        }
        await startSave();
      }
    },

    dispose(): void {
      disposed = true;
      clearDebounce();
    },

    getSnapshot(): SceneSaveQueueSnapshot {
      return snapshot();
    },

    getLatestDocument(): SceneDocumentV1 {
      return latestDocument;
    },

    getAcknowledgedWorkingVersion(): number {
      return acknowledgedWorkingVersion;
    }
  };

  return queue;
}
