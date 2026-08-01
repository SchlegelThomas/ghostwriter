import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_AGENT_PREFS,
  filterWorkspaceAgentPickerModels,
  filterWorkspaceAgentModelPickerOptionsByQuery,
  filterWorkspaceImageModels,
  normalizeWorkspaceAgentPrefs,
  readWorkspaceAgentPrefs,
  resolveWorkspaceAgentModel,
  workspaceAgentModelPickerOptions,
  workspaceAgentPrefsStorageKey,
  writeWorkspaceAgentPrefs,
  accountHasAvailableImageModels,
  defaultWorkspaceImageModelId,
  workspaceImageModelPickerOptions,
  type WorkspaceAvailableModel
} from "./workspace-agent-prefs.js";

const SAMPLE_MODELS: readonly WorkspaceAvailableModel[] = Object.freeze([
  Object.freeze({
    id: "gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    adapterReady: true
  }),
  Object.freeze({
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    label: "Claude Sonnet 4.5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    adapterReady: true
  }),
  Object.freeze({
    id: "gpt-image-1",
    provider: "openai",
    label: "GPT Image 1",
    supportsChat: false,
    supportsTools: false,
    supportsStructured: false,
    supportsImage: true,
    adapterReady: true
  })
]);

const PROJECT_ID = "project_prefs_test";

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

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(workspaceAgentPrefsStorageKey(PROJECT_ID));
  }
});

describe("workspace-agent-prefs", () => {
  it("normalizes invalid payloads to defaults", () => {
    expect(normalizeWorkspaceAgentPrefs(null)).toEqual(DEFAULT_WORKSPACE_AGENT_PREFS);
    expect(
      normalizeWorkspaceAgentPrefs({
        mode: "ask",
        model: "not a model",
        effort: "turbo"
      })
    ).toEqual(DEFAULT_WORKSPACE_AGENT_PREFS);
  });

  it("persists and reads prefs per project", () => {
    writeWorkspaceAgentPrefs(PROJECT_ID, {
      mode: "plan",
      model: "o4-mini",
      effort: "high"
    });
    expect(readWorkspaceAgentPrefs(PROJECT_ID)).toEqual({
      mode: "plan",
      model: "o4-mini",
      effort: "high"
    });
    expect(readWorkspaceAgentPrefs("other-project")).toEqual(
      DEFAULT_WORKSPACE_AGENT_PREFS
    );
  });

  it("filters agent mode models to tool-capable chat entries", () => {
    expect(filterWorkspaceAgentPickerModels(SAMPLE_MODELS, "agent")).toEqual([
      SAMPLE_MODELS[0],
      SAMPLE_MODELS[1]
    ]);
    expect(filterWorkspaceAgentPickerModels(SAMPLE_MODELS, "chat")).toEqual([
      SAMPLE_MODELS[0],
      SAMPLE_MODELS[1]
    ]);
  });

  it("falls back when stored model is unavailable", () => {
    expect(
      resolveWorkspaceAgentModel("gpt-9", SAMPLE_MODELS, "chat")
    ).toBe("gpt-4.1");
    expect(
      resolveWorkspaceAgentModel("gpt-image-1", SAMPLE_MODELS, "chat")
    ).toBe("gpt-4.1");
  });

  it("builds a flat picker sorted by model name", () => {
    const options = workspaceAgentModelPickerOptions(SAMPLE_MODELS, "chat");
    expect(options.map((option) => option.value)).toEqual([
      "claude-sonnet-4-5",
      "gpt-4.1"
    ]);
    expect(options[0]).toMatchObject({
      value: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      provider: "anthropic"
    });
    expect(options[0]?.bestFor).toEqual(expect.any(String));
    expect(options[0]?.relativeStrength).toEqual(expect.any(String));
  });

  it("filters picker options by search query", () => {
    const options = workspaceAgentModelPickerOptions(SAMPLE_MODELS, "chat");
    expect(
      filterWorkspaceAgentModelPickerOptionsByQuery(options, "claude")
    ).toEqual([options[0]]);
    expect(
      filterWorkspaceAgentModelPickerOptionsByQuery(options, "openai")
    ).toEqual([options[1]]);
    expect(filterWorkspaceAgentModelPickerOptionsByQuery(options, "")).toEqual(
      options
    );
  });

  it("filters image-capable adapter-ready models", () => {
    expect(filterWorkspaceImageModels(SAMPLE_MODELS)).toEqual([
      SAMPLE_MODELS[2]
    ]);
    expect(accountHasAvailableImageModels(SAMPLE_MODELS)).toBe(true);
    expect(accountHasAvailableImageModels(SAMPLE_MODELS.slice(0, 2))).toBe(false);
  });

  it("defaults image model to catalog default when available", () => {
    expect(defaultWorkspaceImageModelId(SAMPLE_MODELS)).toBe("gpt-image-1");
    expect(workspaceImageModelPickerOptions(SAMPLE_MODELS)).toEqual([
      { value: "gpt-image-1", label: "GPT Image 1 · OpenAI" }
    ]);
  });

});
