import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_AGENT_PREFS,
  normalizeWorkspaceAgentPrefs,
  readWorkspaceAgentPrefs,
  workspaceAgentPrefsStorageKey,
  writeWorkspaceAgentPrefs
} from "./workspace-agent-prefs.js";

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
        model: "gpt-9",
        effort: "turbo"
      })
    ).toEqual(DEFAULT_WORKSPACE_AGENT_PREFS);
  });

  it("persists and reads prefs per project", () => {
    writeWorkspaceAgentPrefs(PROJECT_ID, {
      mode: "plan",
      model: "gpt-5.6-sol",
      effort: "high"
    });
    expect(readWorkspaceAgentPrefs(PROJECT_ID)).toEqual({
      mode: "plan",
      model: "gpt-5.6-sol",
      effort: "high"
    });
    expect(readWorkspaceAgentPrefs("other-project")).toEqual(
      DEFAULT_WORKSPACE_AGENT_PREFS
    );
  });
});
