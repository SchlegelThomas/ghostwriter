import type { AgentModelId } from "@ghostwriter/core";
import {
  CAPTURE_REFLECTION_DEFAULT_MODEL,
  DEFAULT_IMAGE_MODEL_ID,
  getModelCatalogEntry,
  isAgentModelId,
  PROVIDER_IDS
} from "@ghostwriter/core";

export type WorkspaceAvailableModel = Readonly<{
  id: string;
  provider: string;
  label: string;
  supportsChat: boolean;
  supportsTools: boolean;
  supportsStructured: boolean;
  supportsImage: boolean;
  adapterReady?: boolean;
  bestFor?: string;
  relativeStrength?: string;
  notes?: string;
}>;

export const WORKSPACE_AGENT_MODES = ["chat", "plan", "agent"] as const;
export type WorkspaceAgentMode = (typeof WORKSPACE_AGENT_MODES)[number];

export const WORKSPACE_AGENT_EFFORTS = ["fast", "standard", "high"] as const;
export type WorkspaceAgentEffort = (typeof WORKSPACE_AGENT_EFFORTS)[number];

export type WorkspaceAgentPrefs = Readonly<{
  mode: WorkspaceAgentMode;
  model: AgentModelId;
  effort: WorkspaceAgentEffort;
  autoSuggestions: boolean;
}>;

export const DEFAULT_WORKSPACE_AGENT_PREFS: WorkspaceAgentPrefs = Object.freeze({
  mode: "chat",
  model: CAPTURE_REFLECTION_DEFAULT_MODEL,
  effort: "standard",
  autoSuggestions: false
});

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

function isStoredAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string" && isAgentModelId(value);
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
    model: isStoredAgentModelId(record.model)
      ? record.model
      : DEFAULT_WORKSPACE_AGENT_PREFS.model,
    effort: isWorkspaceAgentEffort(record.effort)
      ? record.effort
      : DEFAULT_WORKSPACE_AGENT_PREFS.effort,
    autoSuggestions:
      typeof record.autoSuggestions === "boolean"
        ? record.autoSuggestions
        : DEFAULT_WORKSPACE_AGENT_PREFS.autoSuggestions
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
  prefs: Partial<WorkspaceAgentPrefs>
): void {
  if (typeof globalThis.localStorage === "undefined") return;
  const normalized = normalizeWorkspaceAgentPrefs({
    ...readWorkspaceAgentPrefs(projectId),
    ...prefs
  });
  globalThis.localStorage.setItem(
    workspaceAgentPrefsStorageKey(projectId),
    JSON.stringify(normalized)
  );
}

export function agentModelLabel(model: AgentModelId): string {
  return getModelCatalogEntry(model)?.label ?? model;
}

function modelAdapterReady(entry: WorkspaceAvailableModel): boolean {
  return entry.adapterReady !== false;
}

export function providerDisplayLabel(providerId: string): string {
  switch (providerId) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "groq":
      return "Groq";
    case "xai":
      return "xAI";
    case "mistral":
      return "Mistral";
    case "deepseek":
      return "DeepSeek";
    case "openrouter":
      return "OpenRouter";
    default:
      return providerId;
  }
}

export function filterWorkspaceAgentPickerModels(
  models: readonly WorkspaceAvailableModel[],
  mode: WorkspaceAgentMode
): readonly WorkspaceAvailableModel[] {
  return models.filter((entry) => {
    if (!entry.supportsChat || !modelAdapterReady(entry)) return false;
    if (mode === "agent") {
      return entry.supportsTools;
    }
    return true;
  });
}

export function accountHasAvailableChatModels(
  models: readonly WorkspaceAvailableModel[]
): boolean {
  return filterWorkspaceAgentPickerModels(models, "chat").length > 0;
}

export function accountHasAvailableStructuredModels(
  models: readonly WorkspaceAvailableModel[]
): boolean {
  return models.some(
    (entry) => entry.supportsStructured && modelAdapterReady(entry)
  );
}

export function filterWorkspaceImageModels(
  models: readonly WorkspaceAvailableModel[]
): readonly WorkspaceAvailableModel[] {
  return models.filter(
    (entry) => entry.supportsImage && modelAdapterReady(entry)
  );
}

export function accountHasAvailableImageModels(
  models: readonly WorkspaceAvailableModel[]
): boolean {
  return filterWorkspaceImageModels(models).length > 0;
}

export function defaultWorkspaceImageModelId(
  models: readonly WorkspaceAvailableModel[]
): string {
  return resolveWorkspaceImageModelId(models, undefined);
}

export function resolveWorkspaceImageModelId(
  models: readonly WorkspaceAvailableModel[],
  preferredModelId: string | undefined
): string {
  const imageModels = filterWorkspaceImageModels(models);
  if (imageModels.length === 0) {
    return DEFAULT_IMAGE_MODEL_ID;
  }
  if (
    preferredModelId !== undefined &&
    imageModels.some((entry) => entry.id === preferredModelId)
  ) {
    return preferredModelId;
  }
  const preferred = imageModels.find(
    (entry) => entry.id === DEFAULT_IMAGE_MODEL_ID
  );
  return (preferred ?? imageModels[0]!).id;
}

export type WorkspaceImageModelPickerOption = Readonly<{
  value: string;
  label: string;
}>;

export function workspaceImageModelPickerOptions(
  models: readonly WorkspaceAvailableModel[]
): readonly WorkspaceImageModelPickerOption[] {
  const filtered = [...filterWorkspaceImageModels(models)].sort((left, right) => {
    const byProvider =
      providerSortIndex(left.provider) - providerSortIndex(right.provider);
    if (byProvider !== 0) return byProvider;
    return left.label.localeCompare(right.label);
  });
  return Object.freeze(
    filtered.map((entry) =>
      Object.freeze({
        value: entry.id,
        label: `${entry.label} · ${providerDisplayLabel(entry.provider)}`
      })
    )
  );
}

export function defaultWorkspaceChatModelId(
  models: readonly WorkspaceAvailableModel[]
): AgentModelId {
  const chatModels = filterWorkspaceAgentPickerModels(models, "chat");
  if (chatModels.length === 0) {
    return DEFAULT_WORKSPACE_AGENT_PREFS.model;
  }
  const preferred = chatModels.find(
    (entry) => entry.id === CAPTURE_REFLECTION_DEFAULT_MODEL
  );
  return (preferred ?? chatModels[0]!).id as AgentModelId;
}

export function resolveWorkspaceAgentModel(
  preferred: AgentModelId,
  models: readonly WorkspaceAvailableModel[],
  mode: WorkspaceAgentMode
): AgentModelId {
  const pickerModels = filterWorkspaceAgentPickerModels(models, mode);
  if (pickerModels.some((entry) => entry.id === preferred)) {
    return preferred;
  }
  return defaultWorkspaceChatModelId(pickerModels);
}

export type WorkspaceAgentModelPickerOption = Readonly<{
  value: AgentModelId;
  label: string;
  provider: string;
  bestFor?: string;
  relativeStrength?: string;
}>;

function providerSortIndex(providerId: string): number {
  const index = (PROVIDER_IDS as readonly string[]).indexOf(providerId);
  return index === -1 ? PROVIDER_IDS.length : index;
}

export function filterWorkspaceAgentModelPickerOptionsByQuery(
  options: readonly WorkspaceAgentModelPickerOption[],
  query: string
): readonly WorkspaceAgentModelPickerOption[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return options;
  }
  return Object.freeze(
    options.filter((option) => {
      const haystack = [
        option.label,
        option.provider,
        option.value,
        providerDisplayLabel(option.provider),
        option.bestFor ?? "",
        option.relativeStrength ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    })
  );
}

/** @deprecated Prefer a flat picker; kept for any transitional callers. */
export type WorkspaceAgentModelPickerGroup = Readonly<{
  provider: string;
  providerLabel: string;
  options: readonly WorkspaceAgentModelPickerOption[];
}>;

/** @deprecated Prefer a flat picker sorted by label. */
export function groupWorkspaceAgentModelPickerOptions(
  options: readonly WorkspaceAgentModelPickerOption[]
): readonly WorkspaceAgentModelPickerGroup[] {
  const byProvider = new Map<string, WorkspaceAgentModelPickerOption[]>();
  for (const option of options) {
    const bucket = byProvider.get(option.provider) ?? [];
    bucket.push(option);
    byProvider.set(option.provider, bucket);
  }
  const sortedProviders = [...byProvider.keys()].sort(
    (left, right) => providerSortIndex(left) - providerSortIndex(right)
  );
  return Object.freeze(
    sortedProviders.map((provider) =>
      Object.freeze({
        provider,
        providerLabel: providerDisplayLabel(provider),
        options: Object.freeze(byProvider.get(provider)!)
      })
    )
  );
}

export function workspaceAgentModelPickerOptions(
  models: readonly WorkspaceAvailableModel[],
  mode: WorkspaceAgentMode
): readonly WorkspaceAgentModelPickerOption[] {
  const filtered = [...filterWorkspaceAgentPickerModels(models, mode)].sort(
    (left, right) => left.label.localeCompare(right.label)
  );
  return Object.freeze(
    filtered.map((entry) => {
      const catalog = getModelCatalogEntry(entry.id);
      return Object.freeze({
        value: entry.id as AgentModelId,
        label: entry.label,
        provider: entry.provider,
        ...(entry.bestFor !== undefined || catalog?.bestFor !== undefined
          ? { bestFor: entry.bestFor ?? catalog?.bestFor }
          : {}),
        ...(entry.relativeStrength !== undefined ||
        catalog?.relativeStrength !== undefined
          ? {
              relativeStrength:
                entry.relativeStrength ?? catalog?.relativeStrength
            }
          : {})
      });
    })
  );
}

export function agentModelLabelWithProvider(
  model: AgentModelId,
  models: readonly WorkspaceAvailableModel[] | undefined
): string {
  const fromCatalog = models?.find((entry) => entry.id === model);
  if (fromCatalog !== undefined) {
    return fromCatalog.label;
  }
  return agentModelLabel(model);
}

export function workspaceAgentModeLabel(mode: WorkspaceAgentMode): string {
  switch (mode) {
    case "chat":
      return "Chat";
    case "plan":
      return "Plan";
    case "agent":
      return "Agent";
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
