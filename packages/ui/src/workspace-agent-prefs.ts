import type { AgentModelId } from "@ghostwriter/core";
import { CAPTURE_REFLECTION_DEFAULT_MODEL } from "@ghostwriter/core";

export const WORKSPACE_AGENT_MODES = ["chat", "plan", "agent"] as const;
export type WorkspaceAgentMode = (typeof WORKSPACE_AGENT_MODES)[number];

export const WORKSPACE_AGENT_EFFORTS = ["fast", "standard", "high"] as const;
export type WorkspaceAgentEffort = (typeof WORKSPACE_AGENT_EFFORTS)[number];

export type WorkspaceAgentPrefs = Readonly<{
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
}>;

export const DEFAULT_WORKSPACE_AGENT_PREFS: WorkspaceAgentPrefs = Object.freeze({
  mode: "chat",
  model: CAPTURE_REFLECTION_DEFAULT_MODEL,
  effort: "standard"
});

const MODEL_IDS = Object.freeze([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol"
] as const satisfies readonly AgentModelId[]);

export function workspaceAgentPrefsStorageKey(projectId: string): string {
  return `ghostwriter:workspace-agent-prefs:${projectId}`;
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

function isAgentModelId(value: unknown): value is AgentModelId {
  return (
    typeof value === "string" &&
    (MODEL_IDS as readonly string[]).includes(value)
  );
}

export function normalizeWorkspaceAgentPrefs(
  value: unknown
): WorkspaceAgentPrefs {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_WORKSPACE_AGENT_PREFS;
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    mode: isWorkspaceAgentMode(record.mode)
      ? record.mode
      : DEFAULT_WORKSPACE_AGENT_PREFS.mode,
    model: isAgentModelId(record.model)
      ? record.model
      : DEFAULT_WORKSPACE_AGENT_PREFS.model,
    effort: isWorkspaceAgentEffort(record.effort)
      ? record.effort
      : DEFAULT_WORKSPACE_AGENT_PREFS.effort
  });
}

export function readWorkspaceAgentPrefs(
  projectId: string
): WorkspaceAgentPrefs {
  if (typeof globalThis.localStorage === "undefined") {
    return DEFAULT_WORKSPACE_AGENT_PREFS;
  }
  const raw = globalThis.localStorage.getItem(
    workspaceAgentPrefsStorageKey(projectId)
  );
  if (raw === null) return DEFAULT_WORKSPACE_AGENT_PREFS;
  try {
    return normalizeWorkspaceAgentPrefs(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_WORKSPACE_AGENT_PREFS;
  }
}

export function writeWorkspaceAgentPrefs(
  projectId: string,
  prefs: WorkspaceAgentPrefs
): void {
  if (typeof globalThis.localStorage === "undefined") return;
  const normalized = normalizeWorkspaceAgentPrefs(prefs);
  globalThis.localStorage.setItem(
    workspaceAgentPrefsStorageKey(projectId),
    JSON.stringify(normalized)
  );
}

export function agentModelLabel(model: AgentModelId): string {
  switch (model) {
    case "gpt-5.6-luna":
      return "Luna";
    case "gpt-5.6-terra":
      return "Terra";
    case "gpt-5.6-sol":
      return "Sol";
  }
}

export function workspaceAgentModeLabel(mode: WorkspaceAgentMode): string {
  switch (mode) {
    case "chat":
      return "chat";
    case "plan":
      return "Plan";
    case "agent":
      return "agent";
  }
}

export function workspaceAgentEffortLabel(effort: WorkspaceAgentEffort): string {
  switch (effort) {
    case "fast":
      return "Fast";
    case "standard":
      return "Standard";
    case "high":
      return "High";
  }
}
