import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceChatMessage } from "./WorkspaceChatPanel.js";
import {
  DEFAULT_CHAT_SESSION_TITLE,
  WORKSPACE_CHAT_MESSAGES_MAX,
  WORKSPACE_CHAT_SESSIONS_MAX,
  appendWorkspaceChatMessage,
  collectWorkspaceChatPriorTurns,
  createWorkspaceChatSession,
  deleteWorkspaceChatSession,
  emptyWorkspaceChatSessionsState,
  forkWorkspaceChatSession,
  loadWorkspaceChatSessions,
  normalizeWorkspaceChatSessionsState,
  renameWorkspaceChatSession,
  saveWorkspaceChatSessions,
  setActiveWorkspaceChatSession,
  trimSessionMessages,
  workspaceChatSessionsStorageKey
} from "./workspace-chat-sessions.js";

const ACCOUNT_ID = "acct_sessions_test";
const PROJECT_ID = "project_sessions_test";

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

function userMessage(id: string, body: string): WorkspaceChatMessage {
  return Object.freeze({ id, role: "user", body });
}

function assistantMessage(id: string, body: string): WorkspaceChatMessage {
  return Object.freeze({ id, role: "assistant", body });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(
      workspaceChatSessionsStorageKey(ACCOUNT_ID, PROJECT_ID)
    );
  }
});

describe("workspace-chat-sessions", () => {
  it("normalizes invalid payloads to a single default session", () => {
    const normalized = normalizeWorkspaceChatSessionsState(null);
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.activeSessionId).toBe(normalized.sessions[0]?.id);
    expect(normalized.sessions[0]?.title).toBe(DEFAULT_CHAT_SESSION_TITLE);
  });

  it("persists and loads sessions per account and project", () => {
    let state = emptyWorkspaceChatSessionsState("2026-08-01T12:00:00.000Z");
    state = appendWorkspaceChatMessage(
      state,
      state.activeSessionId,
      userMessage("u1", "Hello continuity")
    );
    saveWorkspaceChatSessions(ACCOUNT_ID, PROJECT_ID, state);
    const loaded = loadWorkspaceChatSessions(ACCOUNT_ID, PROJECT_ID);
    expect(loaded.sessions[0]?.messages).toEqual([
      userMessage("u1", "Hello continuity")
    ]);
    expect(loaded.sessions[0]?.title).toBe("Hello continuity");
    expect(loadWorkspaceChatSessions("other", PROJECT_ID).sessions).toHaveLength(
      1
    );
  });

  it("uses anonymous scope when account id is missing", () => {
    saveWorkspaceChatSessions(undefined, PROJECT_ID, emptyWorkspaceChatSessionsState());
    expect(workspaceChatSessionsStorageKey(undefined, PROJECT_ID)).toContain(
      "anonymous"
    );
    expect(
      globalThis.localStorage.getItem(
        workspaceChatSessionsStorageKey(undefined, PROJECT_ID)
      )
    ).not.toBeNull();
  });

  it("trims oldest user/assistant pairs when message cap is exceeded", () => {
    const messages: WorkspaceChatMessage[] = [];
    for (let index = 0; index < 45; index += 1) {
      messages.push(userMessage(`u${index}`, `question ${index}`));
      messages.push(assistantMessage(`a${index}`, `answer ${index}`));
    }
    expect(messages).toHaveLength(90);
    const trimmed = trimSessionMessages(messages);
    expect(trimmed.length).toBeLessThanOrEqual(WORKSPACE_CHAT_MESSAGES_MAX);
    expect(trimmed[0]?.id).toBe("u5");
    expect(trimmed.at(-1)?.id).toBe("a44");
  });

  it("refuses deleting the last remaining session", () => {
    const state = emptyWorkspaceChatSessionsState();
    expect(
      deleteWorkspaceChatSession(state, state.activeSessionId)
    ).toBeNull();
  });

  it("caps session count when creating new sessions", () => {
    let state = emptyWorkspaceChatSessionsState();
    while (state.sessions.length < WORKSPACE_CHAT_SESSIONS_MAX) {
      state = createWorkspaceChatSession(state);
    }
    expect(state.sessions).toHaveLength(WORKSPACE_CHAT_SESSIONS_MAX);
    state = createWorkspaceChatSession(state);
    expect(state.sessions).toHaveLength(WORKSPACE_CHAT_SESSIONS_MAX);
  });

  it("switches active session and renames sessions", () => {
    let state = emptyWorkspaceChatSessionsState();
    state = createWorkspaceChatSession(state);
    const secondId = state.activeSessionId;
    state = renameWorkspaceChatSession(state, secondId, "Scene beats");
    state = setActiveWorkspaceChatSession(
      state,
      state.sessions.find((session) => session.id !== secondId)!.id
    );
    expect(state.activeSessionId).not.toBe(secondId);
    expect(
      state.sessions.find((session) => session.id === secondId)?.title
    ).toBe("Scene beats");
  });

  it("forks a session through a chosen message and activates it", () => {
    let state = emptyWorkspaceChatSessionsState();
    state = renameWorkspaceChatSession(state, state.activeSessionId, "Parent");
    state = appendWorkspaceChatMessage(
      state,
      state.activeSessionId,
      userMessage("u1", "First")
    );
    state = appendWorkspaceChatMessage(
      state,
      state.activeSessionId,
      assistantMessage("a1", "Reply")
    );
    const forked = forkWorkspaceChatSession(state, state.activeSessionId, "u1");
    expect(forked).not.toBeNull();
    const next = forked!;
    expect(next.activeSessionId).not.toBe(state.activeSessionId);
    const session = next.sessions.find(
      (entry) => entry.id === next.activeSessionId
    );
    expect(session?.title).toBe("Fork · Parent");
    expect(session?.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("collects bounded prior turns for regenerate coherence", () => {
    const messages = [
      userMessage("u1", "One"),
      assistantMessage("a1", "Alpha"),
      userMessage("u2", "Two"),
      assistantMessage("a2", "Beta")
    ];
    expect(collectWorkspaceChatPriorTurns(messages)).toEqual([
      { role: "user", body: "One" },
      { role: "assistant", body: "Alpha" },
      { role: "user", body: "Two" },
      { role: "assistant", body: "Beta" }
    ]);
    expect(
      collectWorkspaceChatPriorTurns(messages, 2).map((turn) => turn.body)
    ).toEqual(["Two", "Beta"]);
  });
});
