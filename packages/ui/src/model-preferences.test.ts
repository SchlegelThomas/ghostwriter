import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PREFERENCES,
  filterModelsByPreferences,
  isModelEnabled,
  modelPreferencesStorageKey,
  normalizeModelPreferences,
  readModelPreferences,
  resolveTaskModel,
  toggleModelEnabled,
  writeModelPreferences
} from "./model-preferences.js";

const ACCOUNT = "acct_test";

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
    get length(): number {
      return store.size;
    }
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    value: memoryStorage,
    writable: true
  });
}

describe("model-preferences", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("uses account-scoped storage keys when accountId is provided", () => {
    expect(modelPreferencesStorageKey()).toBe("ghostwriter:model-preferences");
    expect(modelPreferencesStorageKey(ACCOUNT)).toBe(
      `ghostwriter:model-preferences:${ACCOUNT}`
    );
  });

  it("defaults to all models enabled", () => {
    expect(readModelPreferences()).toEqual(DEFAULT_MODEL_PREFERENCES);
    expect(isModelEnabled(DEFAULT_MODEL_PREFERENCES, "gpt-4.1")).toBe(true);
  });

  it("persists and normalizes preferences", () => {
    writeModelPreferences(
      {
        enabledModelIds: ["gpt-4.1", "gpt-4.1"],
        taskModels: { chat: "gpt-4.1", agent: "claude-sonnet-4-5" }
      },
      ACCOUNT
    );
    expect(readModelPreferences(ACCOUNT)).toEqual(
      Object.freeze({
        enabledModelIds: Object.freeze(["gpt-4.1"]),
        taskModels: Object.freeze({
          chat: "gpt-4.1",
          agent: "claude-sonnet-4-5"
        })
      })
    );
  });

  it("filters models by enabled ids", () => {
    const models = Object.freeze([
      Object.freeze({ id: "a", label: "A" }),
      Object.freeze({ id: "b", label: "B" })
    ]);
    const prefs = normalizeModelPreferences({
      enabledModelIds: ["b"],
      taskModels: {}
    });
    expect(filterModelsByPreferences(models, prefs)).toEqual([
      Object.freeze({ id: "b", label: "B" })
    ]);
    expect(
      filterModelsByPreferences(models, DEFAULT_MODEL_PREFERENCES)
    ).toEqual(models);
  });

  it("toggles from all → explicit exclude → all again", () => {
    const unlocked = Object.freeze(["a", "b", "c"]);
    const afterDisable = toggleModelEnabled(
      DEFAULT_MODEL_PREFERENCES,
      "b",
      false,
      unlocked
    );
    expect(afterDisable.enabledModelIds).toEqual(
      Object.freeze(["a", "c"])
    );
    expect(isModelEnabled(afterDisable, "b")).toBe(false);
    expect(
      filterModelsByPreferences(
        unlocked.map((id) => Object.freeze({ id })),
        afterDisable
      ).map((entry) => entry.id)
    ).toEqual(["a", "c"]);

    const afterEnable = toggleModelEnabled(afterDisable, "b", true, unlocked);
    expect(afterEnable.enabledModelIds).toBe("all");
  });

  it("ignores toggles for models that are not unlocked", () => {
    const next = toggleModelEnabled(
      DEFAULT_MODEL_PREFERENCES,
      "locked",
      false,
      ["a", "b"]
    );
    expect(next).toBe(DEFAULT_MODEL_PREFERENCES);
  });

  it("resolves task defaults when enabled", () => {
    const prefs = normalizeModelPreferences({
      enabledModelIds: ["gpt-4.1"],
      taskModels: { plan: "gpt-4.1", chat: "disabled-model" }
    });
    expect(resolveTaskModel(prefs, "plan", "fallback")).toBe("gpt-4.1");
    expect(resolveTaskModel(prefs, "chat", "fallback")).toBe("fallback");
    expect(resolveTaskModel(prefs, "agent", "fallback")).toBe("fallback");
  });
});
