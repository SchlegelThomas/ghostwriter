/**
 * Account model enablement and per-task defaults (localStorage v1 — no server persistence).
 */

export type ModelTaskKind =
  | "chat"
  | "plan"
  | "agent"
  | "image"
  | "captureReflection"
  | "scenePartner";

export const MODEL_TASK_KINDS: readonly ModelTaskKind[] = Object.freeze([
  "chat",
  "plan",
  "agent",
  "image",
  "captureReflection",
  "scenePartner"
]);

export type ModelPreferences = Readonly<{
  /** `'all'` = every credential-unlocked model is enabled in pickers. */
  enabledModelIds: readonly string[] | "all";
  taskModels: Partial<Record<ModelTaskKind, string>>;
}>;

export const DEFAULT_MODEL_PREFERENCES: ModelPreferences = Object.freeze({
  enabledModelIds: "all",
  taskModels: Object.freeze({})
});

export function modelPreferencesStorageKey(accountId?: string): string {
  if (accountId !== undefined && accountId.length > 0) {
    return `ghostwriter:model-preferences:${accountId}`;
  }
  return "ghostwriter:model-preferences";
}

function normalizeEnabledModelIds(value: unknown): ModelPreferences["enabledModelIds"] {
  if (value === "all") return "all";
  if (!Array.isArray(value)) return "all";
  const ids = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  );
  return Object.freeze([...new Set(ids)]);
}

function normalizeTaskModels(
  value: unknown
): ModelPreferences["taskModels"] {
  if (typeof value !== "object" || value === null) {
    return Object.freeze({});
  }
  const record = value as Record<string, unknown>;
  const next: Partial<Record<ModelTaskKind, string>> = {};
  for (const kind of MODEL_TASK_KINDS) {
    const raw = record[kind];
    if (typeof raw === "string" && raw.length > 0) {
      next[kind] = raw;
    }
  }
  return Object.freeze(next);
}

export function normalizeModelPreferences(value: unknown): ModelPreferences {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_MODEL_PREFERENCES;
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    enabledModelIds: normalizeEnabledModelIds(record.enabledModelIds),
    taskModels: normalizeTaskModels(record.taskModels)
  });
}

export function readModelPreferences(accountId?: string): ModelPreferences {
  if (typeof globalThis.localStorage === "undefined") {
    return DEFAULT_MODEL_PREFERENCES;
  }
  const raw = globalThis.localStorage.getItem(
    modelPreferencesStorageKey(accountId)
  );
  if (raw === null) return DEFAULT_MODEL_PREFERENCES;
  try {
    return normalizeModelPreferences(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_MODEL_PREFERENCES;
  }
}

export function writeModelPreferences(
  prefs: ModelPreferences,
  accountId?: string
): void {
  if (typeof globalThis.localStorage === "undefined") return;
  const normalized = normalizeModelPreferences(prefs);
  globalThis.localStorage.setItem(
    modelPreferencesStorageKey(accountId),
    JSON.stringify(normalized)
  );
}

export function isModelEnabled(
  prefs: ModelPreferences,
  modelId: string
): boolean {
  if (prefs.enabledModelIds === "all") return true;
  return prefs.enabledModelIds.includes(modelId);
}

export function withEnabledModelIds(
  prefs: ModelPreferences,
  nextIds: readonly string[] | "all"
): ModelPreferences {
  return Object.freeze({
    ...prefs,
    enabledModelIds:
      nextIds === "all" ? "all" : Object.freeze([...new Set(nextIds)])
  });
}

/**
 * Toggle one unlocked model in/out of the enabled set.
 * When every unlocked id is enabled, collapses back to `'all'`.
 */
export function toggleModelEnabled(
  prefs: ModelPreferences,
  modelId: string,
  enabled: boolean,
  unlockedCatalogIds: readonly string[]
): ModelPreferences {
  const unlocked = [...new Set(unlockedCatalogIds)];
  const unlockedSet = new Set(unlocked);
  if (!unlockedSet.has(modelId)) {
    return prefs;
  }

  let ids: string[];
  if (prefs.enabledModelIds === "all") {
    ids = enabled
      ? unlocked
      : unlocked.filter((id) => id !== modelId);
  } else {
    const current = new Set(prefs.enabledModelIds);
    if (enabled) {
      current.add(modelId);
    } else {
      current.delete(modelId);
    }
    ids = unlocked.filter((id) => current.has(id));
  }

  if (ids.length === unlocked.length) {
    return withEnabledModelIds(prefs, "all");
  }
  return withEnabledModelIds(prefs, ids);
}

export function filterModelsByPreferences<
  T extends Readonly<{ id: string }>
>(models: readonly T[], prefs: ModelPreferences): readonly T[] {
  if (prefs.enabledModelIds === "all") return models;
  const enabled = new Set(prefs.enabledModelIds);
  return Object.freeze(models.filter((entry) => enabled.has(entry.id)));
}

export function resolveTaskModel(
  prefs: ModelPreferences,
  task: ModelTaskKind,
  fallback: string | undefined
): string | undefined {
  const candidate = prefs.taskModels[task];
  if (candidate === undefined || candidate.length === 0) {
    return fallback;
  }
  if (!isModelEnabled(prefs, candidate)) {
    return fallback;
  }
  return candidate;
}

export function modelTaskKindLabel(task: ModelTaskKind): string {
  switch (task) {
    case "chat":
      return "Workspace chat";
    case "plan":
      return "Plan mode";
    case "agent":
      return "Agent mode";
    case "image":
      return "Image generation";
    case "captureReflection":
      return "Capture reflection";
    case "scenePartner":
      return "Scene partner";
    default:
      return task;
  }
}
