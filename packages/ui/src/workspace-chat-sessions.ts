import type { AgentModelId } from "@ghostwriter/core";
import { isAgentModelId } from "@ghostwriter/core";
import type { WorkspaceChatMessage } from "./WorkspaceChatPanel.js";
import {
  DEFAULT_WORKSPACE_AGENT_PREFS,
  WORKSPACE_AGENT_EFFORTS,
  WORKSPACE_AGENT_MODES,
  type WorkspaceAgentEffort,
  type WorkspaceAgentMode
} from "./workspace-agent-prefs.js";

export const WORKSPACE_CHAT_SESSIONS_MAX = 12;
export const WORKSPACE_CHAT_MESSAGES_MAX = 80;
export const WORKSPACE_CHAT_PRIOR_TURNS_MAX = 6;
export const DEFAULT_CHAT_SESSION_TITLE = "New chat";
export const AUTO_TITLE_MAX_LENGTH = 40;

export type WorkspaceChatPriorTurn = Readonly<{
  role: "user" | "assistant";
  body: string;
}>;

export type WorkspaceChatSession = Readonly<{
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: readonly WorkspaceChatMessage[];
  mode?: WorkspaceAgentMode;
  model?: AgentModelId;
  effort?: WorkspaceAgentEffort;
}>;

export type WorkspaceChatSessionsState = Readonly<{
  activeSessionId: string;
  sessions: readonly WorkspaceChatSession[];
}>;

function accountScope(accountId: string | undefined): string {
  const trimmed = accountId?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : "anonymous";
}

export function workspaceChatSessionsStorageKey(
  accountId: string | undefined,
  projectId: string
): string {
  return `ghostwriter:workspace-chat-sessions:${accountScope(accountId)}:${projectId}`;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isWorkspaceAgentMode(value: unknown): value is WorkspaceAgentMode {
  return (
    typeof value === "string" &&
    (WORKSPACE_AGENT_MODES as readonly string[]).includes(value)
  );
}

function isWorkspaceAgentEffort(value: unknown): value is WorkspaceAgentEffort {
  return (
    typeof value === "string" &&
    (WORKSPACE_AGENT_EFFORTS as readonly string[]).includes(value)
  );
}

function isStoredAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string" && isAgentModelId(value);
}

function normalizeToolTrace(value: unknown): WorkspaceChatMessage["toolTraces"] {
  if (!Array.isArray(value)) return undefined;
  const traces = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      if (
        typeof record.toolName !== "string" ||
        typeof record.title !== "string" ||
        typeof record.ok !== "boolean" ||
        typeof record.summary !== "string"
      ) {
        return null;
      }
      return Object.freeze({
        toolName: record.toolName,
        title: record.title,
        ok: record.ok,
        summary: record.summary,
        ...(typeof record.errorMessage === "string"
          ? { errorMessage: record.errorMessage }
          : {})
      });
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return traces.length === 0 ? undefined : Object.freeze(traces);
}

export function normalizeWorkspaceChatMessage(
  value: unknown
): WorkspaceChatMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    (record.role !== "user" &&
      record.role !== "assistant" &&
      record.role !== "system") ||
    typeof record.body !== "string"
  ) {
    return null;
  }
  const toolTraces = normalizeToolTrace(record.toolTraces);
  return Object.freeze({
    id: record.id,
    role: record.role,
    body: record.body,
    ...(record.streaming === true ? { streaming: true } : {}),
    ...(typeof record.statusLabel === "string"
      ? { statusLabel: record.statusLabel }
      : {}),
    ...(toolTraces === undefined ? {} : { toolTraces }),
    ...(record.retryable === true ? { retryable: true } : {})
  });
}

function normalizeSessionTitle(title: unknown): string {
  if (typeof title !== "string") return DEFAULT_CHAT_SESSION_TITLE;
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CHAT_SESSION_TITLE;
}

export function normalizeWorkspaceChatSession(
  value: unknown
): WorkspaceChatSession | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    return null;
  }
  const createdAt = isIsoTimestamp(record.createdAt)
    ? record.createdAt
    : new Date().toISOString();
  const updatedAt = isIsoTimestamp(record.updatedAt)
    ? record.updatedAt
    : createdAt;
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = Object.freeze(
    rawMessages
      .map((entry) => normalizeWorkspaceChatMessage(entry))
      .filter((entry): entry is WorkspaceChatMessage => entry !== null)
  );
  const trimmedMessages = trimSessionMessages(messages);
  return Object.freeze({
    id: record.id,
    title: normalizeSessionTitle(record.title),
    createdAt,
    updatedAt,
    messages: trimmedMessages,
    ...(isWorkspaceAgentMode(record.mode) ? { mode: record.mode } : {}),
    ...(isStoredAgentModelId(record.model) ? { model: record.model } : {}),
    ...(isWorkspaceAgentEffort(record.effort) ? { effort: record.effort } : {})
  });
}

function createSessionId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `chat-session-${globalThis.crypto.randomUUID()}`;
  }
  return `chat-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptyChatSession(
  now: string = new Date().toISOString()
): WorkspaceChatSession {
  return Object.freeze({
    id: createSessionId(),
    title: DEFAULT_CHAT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: Object.freeze([])
  });
}

export function emptyWorkspaceChatSessionsState(
  now: string = new Date().toISOString()
): WorkspaceChatSessionsState {
  const session = createEmptyChatSession(now);
  return Object.freeze({
    activeSessionId: session.id,
    sessions: Object.freeze([session])
  });
}

function sortSessionsByRecency(
  sessions: readonly WorkspaceChatSession[]
): WorkspaceChatSession[] {
  return [...sessions].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.title.localeCompare(right.title)
  );
}

function enforceSessionCountCap(
  state: WorkspaceChatSessionsState
): WorkspaceChatSessionsState {
  if (state.sessions.length <= WORKSPACE_CHAT_SESSIONS_MAX) {
    return state;
  }
  const sortedOldestFirst = [...state.sessions].sort(
    (left, right) =>
      Date.parse(left.updatedAt) - Date.parse(right.updatedAt) ||
      left.title.localeCompare(right.title)
  );
  let sessions = [...state.sessions];
  for (const candidate of sortedOldestFirst) {
    if (sessions.length <= WORKSPACE_CHAT_SESSIONS_MAX) break;
    if (sessions.length <= 1) break;
    if (candidate.id === state.activeSessionId && sessions.length > 1) {
      continue;
    }
    sessions = sessions.filter((session) => session.id !== candidate.id);
  }
  const activeStillExists = sessions.some(
    (session) => session.id === state.activeSessionId
  );
  const activeSessionId = activeStillExists
    ? state.activeSessionId
    : sessions[0]!.id;
  return Object.freeze({
    activeSessionId,
    sessions: Object.freeze(sessions)
  });
}

export function trimSessionMessages(
  messages: readonly WorkspaceChatMessage[]
): readonly WorkspaceChatMessage[] {
  if (messages.length <= WORKSPACE_CHAT_MESSAGES_MAX) {
    return messages;
  }
  let trimmed = [...messages];
  while (trimmed.length > WORKSPACE_CHAT_MESSAGES_MAX) {
    const firstUserIndex = trimmed.findIndex((message) => message.role === "user");
    if (firstUserIndex === -1) {
      trimmed = trimmed.slice(1);
      continue;
    }
    let endIndex = firstUserIndex + 1;
    while (endIndex < trimmed.length && trimmed[endIndex]?.role !== "user") {
      endIndex += 1;
    }
    trimmed = trimmed.slice(0, firstUserIndex).concat(trimmed.slice(endIndex));
  }
  return Object.freeze(trimmed);
}

export function autoTitleFromUserMessage(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return DEFAULT_CHAT_SESSION_TITLE;
  if (collapsed.length <= AUTO_TITLE_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, AUTO_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function mapSession(
  state: WorkspaceChatSessionsState,
  sessionId: string,
  update: (session: WorkspaceChatSession) => WorkspaceChatSession
): WorkspaceChatSessionsState {
  let changed = false;
  const sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    changed = true;
    return update(session);
  });
  if (!changed) return state;
  return enforceSessionCountCap(
    Object.freeze({
      activeSessionId: state.activeSessionId,
      sessions: Object.freeze(sessions)
    })
  );
}

export function normalizeWorkspaceChatSessionsState(
  value: unknown
): WorkspaceChatSessionsState {
  if (typeof value !== "object" || value === null) {
    return emptyWorkspaceChatSessionsState();
  }
  const record = value as Record<string, unknown>;
  const rawSessions = Array.isArray(record.sessions) ? record.sessions : [];
  const sessions = rawSessions
    .map((entry) => normalizeWorkspaceChatSession(entry))
    .filter((entry): entry is WorkspaceChatSession => entry !== null);
  if (sessions.length === 0) {
    return emptyWorkspaceChatSessionsState();
  }
  const activeSessionId =
    typeof record.activeSessionId === "string" &&
    sessions.some((session) => session.id === record.activeSessionId)
      ? record.activeSessionId
      : sortSessionsByRecency(sessions)[0]!.id;
  return enforceSessionCountCap(
    Object.freeze({
      activeSessionId,
      sessions: Object.freeze(sessions)
    })
  );
}

export function loadWorkspaceChatSessions(
  accountId: string | undefined,
  projectId: string
): WorkspaceChatSessionsState {
  if (typeof globalThis.localStorage === "undefined") {
    return emptyWorkspaceChatSessionsState();
  }
  const raw = globalThis.localStorage.getItem(
    workspaceChatSessionsStorageKey(accountId, projectId)
  );
  if (raw === null) return emptyWorkspaceChatSessionsState();
  try {
    return normalizeWorkspaceChatSessionsState(JSON.parse(raw) as unknown);
  } catch {
    return emptyWorkspaceChatSessionsState();
  }
}

export function saveWorkspaceChatSessions(
  accountId: string | undefined,
  projectId: string,
  state: WorkspaceChatSessionsState
): void {
  if (typeof globalThis.localStorage === "undefined") return;
  const normalized = normalizeWorkspaceChatSessionsState(state);
  globalThis.localStorage.setItem(
    workspaceChatSessionsStorageKey(accountId, projectId),
    JSON.stringify(normalized)
  );
}

export function createWorkspaceChatSession(
  state: WorkspaceChatSessionsState,
  prefs: Readonly<{
    mode?: WorkspaceAgentMode;
    model?: AgentModelId;
    effort?: WorkspaceAgentEffort;
  }> = {}
): WorkspaceChatSessionsState {
  const now = new Date().toISOString();
  const session = Object.freeze({
    ...createEmptyChatSession(now),
    ...(prefs.mode === undefined ? {} : { mode: prefs.mode }),
    ...(prefs.model === undefined ? {} : { model: prefs.model }),
    ...(prefs.effort === undefined ? {} : { effort: prefs.effort })
  });
  const sessions = Object.freeze([session, ...state.sessions]);
  let next = Object.freeze({
    activeSessionId: session.id,
    sessions
  });
  next = enforceSessionCountCap(next);
  return next;
}

export function renameWorkspaceChatSession(
  state: WorkspaceChatSessionsState,
  sessionId: string,
  title: string
): WorkspaceChatSessionsState {
  const normalizedTitle = normalizeSessionTitle(title);
  const now = new Date().toISOString();
  return mapSession(state, sessionId, (session) =>
    Object.freeze({
      ...session,
      title: normalizedTitle,
      updatedAt: now
    })
  );
}

export function setActiveWorkspaceChatSession(
  state: WorkspaceChatSessionsState,
  sessionId: string
): WorkspaceChatSessionsState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }
  return Object.freeze({
    activeSessionId: sessionId,
    sessions: state.sessions
  });
}

export function deleteWorkspaceChatSession(
  state: WorkspaceChatSessionsState,
  sessionId: string
): WorkspaceChatSessionsState | null {
  if (state.sessions.length <= 1) return null;
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }
  const sessions = Object.freeze(
    state.sessions.filter((session) => session.id !== sessionId)
  );
  const activeSessionId =
    state.activeSessionId === sessionId
      ? sessions[0]!.id
      : state.activeSessionId;
  return Object.freeze({
    activeSessionId,
    sessions
  });
}

function applyAutoTitle(
  session: WorkspaceChatSession,
  message: WorkspaceChatMessage
): string {
  if (message.role !== "user") return session.title;
  if (session.title !== DEFAULT_CHAT_SESSION_TITLE) return session.title;
  return autoTitleFromUserMessage(message.body);
}

export function appendWorkspaceChatMessage(
  state: WorkspaceChatSessionsState,
  sessionId: string,
  message: WorkspaceChatMessage
): WorkspaceChatSessionsState {
  const now = new Date().toISOString();
  return mapSession(state, sessionId, (session) =>
    Object.freeze({
      ...session,
      title: applyAutoTitle(session, message),
      updatedAt: now,
      messages: trimSessionMessages([...session.messages, message])
    })
  );
}

export function replaceWorkspaceChatMessages(
  state: WorkspaceChatSessionsState,
  sessionId: string,
  messages: readonly WorkspaceChatMessage[]
): WorkspaceChatSessionsState {
  const now = new Date().toISOString();
  const sanitized = trimSessionMessages(
    messages
      .map((entry) => normalizeWorkspaceChatMessage(entry))
      .filter((entry): entry is WorkspaceChatMessage => entry !== null)
  );
  return mapSession(state, sessionId, (session) =>
    Object.freeze({
      ...session,
      updatedAt: now,
      messages: sanitized
    })
  );
}

export function updateActiveWorkspaceChatSessionPrefs(
  state: WorkspaceChatSessionsState,
  prefs: Readonly<{
    mode?: WorkspaceAgentMode;
    model?: AgentModelId;
    effort?: WorkspaceAgentEffort;
  }>
): WorkspaceChatSessionsState {
  return mapSession(state, state.activeSessionId, (session) =>
    Object.freeze({
      ...session,
      updatedAt: new Date().toISOString(),
      ...(prefs.mode === undefined ? {} : { mode: prefs.mode }),
      ...(prefs.model === undefined ? {} : { model: prefs.model }),
      ...(prefs.effort === undefined ? {} : { effort: prefs.effort })
    })
  );
}

export function activeWorkspaceChatSession(
  state: WorkspaceChatSessionsState
): WorkspaceChatSession | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

export function activeWorkspaceChatMessages(
  state: WorkspaceChatSessionsState
): readonly WorkspaceChatMessage[] {
  return activeWorkspaceChatSession(state)?.messages ?? [];
}

export function sessionAgentPrefsFromState(
  state: WorkspaceChatSessionsState
): Readonly<{
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
}> {
  const session = activeWorkspaceChatSession(state);
  return Object.freeze({
    mode: session?.mode ?? DEFAULT_WORKSPACE_AGENT_PREFS.mode,
    model: session?.model ?? DEFAULT_WORKSPACE_AGENT_PREFS.model,
    effort: session?.effort ?? DEFAULT_WORKSPACE_AGENT_PREFS.effort
  });
}

export function truncateMessagesBeforeUserMessage(
  messages: readonly WorkspaceChatMessage[],
  userMessageId: string
): readonly WorkspaceChatMessage[] {
  const index = messages.findIndex((message) => message.id === userMessageId);
  if (index === -1) return messages;
  return Object.freeze(messages.slice(0, index));
}

export function removeLastAssistantTurn(
  messages: readonly WorkspaceChatMessage[]
): readonly WorkspaceChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return Object.freeze(messages.slice(0, index));
    }
  }
  return messages;
}

export function findLastUserMessage(
  messages: readonly WorkspaceChatMessage[]
): WorkspaceChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message;
  }
  return undefined;
}

export function collectWorkspaceChatPriorTurns(
  messages: readonly WorkspaceChatMessage[],
  maxTurns: number = WORKSPACE_CHAT_PRIOR_TURNS_MAX
): readonly WorkspaceChatPriorTurn[] {
  const turns: WorkspaceChatPriorTurn[] = [];
  for (
    let index = messages.length - 1;
    index >= 0 && turns.length < maxTurns;
    index -= 1
  ) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const body = message.body.trim();
    if (body.length === 0) continue;
    turns.unshift(Object.freeze({ role: message.role, body }));
  }
  return Object.freeze(turns);
}

export function forkWorkspaceChatSession(
  state: WorkspaceChatSessionsState,
  sourceSessionId: string,
  messageId: string,
  prefs: Readonly<{
    mode?: WorkspaceAgentMode;
    model?: AgentModelId;
    effort?: WorkspaceAgentEffort;
  }> = {}
): WorkspaceChatSessionsState | null {
  const source = state.sessions.find((session) => session.id === sourceSessionId);
  if (source === undefined) return null;
  const messageIndex = source.messages.findIndex(
    (message) => message.id === messageId
  );
  if (messageIndex === -1) return null;
  const now = new Date().toISOString();
  const forkedMessages = trimSessionMessages(
    source.messages.slice(0, messageIndex + 1)
  );
  const session = Object.freeze({
    ...createEmptyChatSession(now),
    title: `Fork · ${source.title}`,
    updatedAt: now,
    messages: forkedMessages,
    ...(prefs.mode !== undefined
      ? { mode: prefs.mode }
      : source.mode === undefined
        ? {}
        : { mode: source.mode }),
    ...(prefs.model !== undefined
      ? { model: prefs.model }
      : source.model === undefined
        ? {}
        : { model: source.model }),
    ...(prefs.effort !== undefined
      ? { effort: prefs.effort }
      : source.effort === undefined
        ? {}
        : { effort: source.effort })
  });
  let next = Object.freeze({
    activeSessionId: session.id,
    sessions: Object.freeze([session, ...state.sessions])
  });
  next = enforceSessionCountCap(next);
  return next;
}
