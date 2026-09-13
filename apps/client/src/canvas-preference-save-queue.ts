import {
  canvasPersonalScopeKey,
  type CanvasPersonalScopeView,
  type CanvasPersonalViewPreference,
  type CanvasScopeRef
} from "@ghostwriter/core";

export type CanvasPreferenceSave = Readonly<{
  scopeView: Omit<CanvasPersonalScopeView, "updatedAt">;
  lastScope: CanvasScopeRef;
}>;

export type CanvasPreferenceSaveQueue = Readonly<{
  enqueue(save: CanvasPreferenceSave): void;
  dispose(): void;
  whenIdle(): Promise<void>;
}>;

export function createCanvasPreferenceSaveQueue(input: Readonly<{
  initialVersion: number;
  load(): Promise<CanvasPersonalViewPreference | null>;
  save(
    save: CanvasPreferenceSave & Readonly<{ expectedPreferenceVersion: number }>
  ): Promise<CanvasPersonalViewPreference>;
  isVersionConflict(cause: unknown): boolean;
  onRebase?(preference: CanvasPersonalViewPreference | null): void;
  onSaved?(preference: CanvasPersonalViewPreference): void;
  onError?(cause: unknown): void;
}>): CanvasPreferenceSaveQueue {
  let version = input.initialVersion;
  let running = false;
  let disposed = false;
  const pending = new Map<string, CanvasPreferenceSave>();
  let idleWaiters: Array<() => void> = [];

  function finishIdle(): void {
    if (running || pending.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function drain(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && pending.size > 0) {
        const nextEntry = pending.entries().next().value as
          | [string, CanvasPreferenceSave]
          | undefined;
        if (nextEntry === undefined) break;
        const [key, queued] = nextEntry;
        pending.delete(key);
        let retried = false;
        while (!disposed) {
          try {
            const saved = await input.save({
              ...queued,
              expectedPreferenceVersion: version
            });
            if (disposed) return;
            version = saved.version;
            input.onSaved?.(saved);
            break;
          } catch (cause) {
            if (!retried && input.isVersionConflict(cause)) {
              retried = true;
              try {
                const latest = await input.load();
                if (disposed) return;
                version = latest?.version ?? 0;
                input.onRebase?.(latest);
                continue;
              } catch (reloadCause) {
                if (!disposed) input.onError?.(reloadCause);
                break;
              }
            }
            if (!disposed) input.onError?.(cause);
            break;
          }
        }
      }
    } finally {
      running = false;
      finishIdle();
      if (!disposed && pending.size > 0) void drain();
    }
  }

  return Object.freeze({
    enqueue(save): void {
      if (disposed) return;
      const key = canvasPersonalScopeKey(save.scopeView.scope);
      pending.delete(key);
      pending.set(key, save);
      void drain();
    },
    dispose(): void {
      disposed = true;
      pending.clear();
      finishIdle();
    },
    whenIdle(): Promise<void> {
      if (!running && pending.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }
  });
}
