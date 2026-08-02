import { DomainValidationError } from "./domain.js";
import type { ProviderId } from "./provider-credentials.js";
import { assertProviderId, PROVIDER_IDS } from "./provider-credentials.js";

/**
 * Model catalog identity convention:
 * - `id` is the real upstream model id (e.g. `gpt-4.1`, `claude-sonnet-4-5`).
 * - Ids must be unique across the curated catalog.
 * - `provider` selects the adapter / credential slot; Wave B long-tail entries may later
 *   route through an openai-compatible bridge without changing the stored id.
 */
export type ModelCatalogEntry = Readonly<{
  id: string;
  provider: ProviderId;
  label: string;
  supportsChat: boolean;
  supportsTools: boolean;
  supportsStructured: boolean;
  supportsImage: boolean;
  defaultEffort?: "fast" | "standard" | "high";
  notes?: string;
  /** Short writer-facing guidance for when to pick this model. */
  bestFor?: string;
  /** Plain-language comparison vs peers in the Ghostwriter catalog (not a lab leaderboard). */
  relativeStrength?: string;
  /** When false, the entry is catalog-only until a live adapter ships. */
  adapterReady: boolean;
}>;

export type AgentEgressClass =
  | "openai-responses"
  | "anthropic-messages"
  | "google-generate"
  | "openai-compatible";

function entry(input: ModelCatalogEntry): ModelCatalogEntry {
  return Object.freeze({ ...input });
}

/**
 * Curated Ghostwriter model catalog (highlights + metadata seeds).
 * Live available-models merges this with per-account provider discovery.
 */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = Object.freeze([
  // Wave A — OpenAI
  entry({
    id: "gpt-5.2",
    provider: "openai",
    label: "GPT-5.2",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "Frontier OpenAI chat when you want the newest general model.",
    relativeStrength:
      "Top OpenAI tier in this catalog; usually stronger than GPT-4.1, costlier than mini/flash.",
    adapterReady: true
  }),
  entry({
    id: "gpt-5.1",
    provider: "openai",
    label: "GPT-5.1",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "Strong general writing help and agent tool use on OpenAI.",
    relativeStrength: "Near frontier; a step below GPT-5.2 when both are available.",
    adapterReady: true
  }),
  entry({
    id: "gpt-5",
    provider: "openai",
    label: "GPT-5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "High-quality OpenAI chat and structured agent turns.",
    relativeStrength: "Stronger than GPT-4.1 for most tasks; prefer dated 5.x aliases when listed.",
    adapterReady: true
  }),
  entry({
    id: "gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Everyday project chat, outlining, and reliable tool use.",
    relativeStrength:
      "Strong all-rounder; usually steadier than mini/flash models, less deep than Opus or o4-mini on hard reasoning.",
    adapterReady: true
  }),
  entry({
    id: "gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 Mini",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Quick answers and cheap iteration while drafting.",
    relativeStrength:
      "Faster/cheaper than GPT-4.1; lighter prose judgment than Sonnet or Gemini Pro.",
    adapterReady: true
  }),
  entry({
    id: "gpt-4o",
    provider: "openai",
    label: "GPT-4o",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Familiar OpenAI default for mixed chat and light vision-adjacent work.",
    relativeStrength: "Solid generalist; GPT-4.1 / GPT-5 usually feel sharper for long prose.",
    adapterReady: true
  }),
  entry({
    id: "o4-mini",
    provider: "openai",
    label: "o4-mini",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    notes: "Reasoning-leaning OpenAI model; effort maps to reasoning posture.",
    bestFor: "Puzzle-y continuity questions and careful multi-step analysis.",
    relativeStrength:
      "Often stronger on structured reasoning than GPT-4.1; can feel slower than Haiku/Flash.",
    adapterReady: true
  }),
  entry({
    id: "gpt-image-1",
    provider: "openai",
    label: "GPT Image 1",
    supportsChat: false,
    supportsTools: false,
    supportsStructured: false,
    supportsImage: true,
    notes: "Image generation only.",
    bestFor: "Cover options and character visuals.",
    relativeStrength: "Ghostwriter’s primary image model today; not used for chat.",
    adapterReady: true
  }),
  entry({
    id: "gpt-image-1.5",
    provider: "openai",
    label: "GPT Image 1.5",
    supportsChat: false,
    supportsTools: false,
    supportsStructured: false,
    supportsImage: true,
    notes: "Image generation only.",
    bestFor: "Newer OpenAI image generations for covers and cast visuals.",
    relativeStrength: "Prefer when listed; otherwise fall back to GPT Image 1.",
    adapterReady: true
  }),

  // Wave A — Anthropic
  entry({
    id: "claude-opus-5",
    provider: "anthropic",
    label: "Claude Opus 5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "Hardest editorial judgment and deep story questions.",
    relativeStrength: "Anthropic’s deepest tier here; slower/costlier than Sonnet 5.",
    adapterReady: true
  }),
  entry({
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Scene craft, voice-sensitive edits, and balanced agent work.",
    relativeStrength:
      "Strong default for prose among Anthropic mid/high tiers; between Haiku speed and Opus depth.",
    adapterReady: true
  }),
  entry({
    id: "claude-fable-5",
    provider: "anthropic",
    label: "Claude Fable 5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Story-forward Anthropic chat when Fable is available on your key.",
    relativeStrength: "Narrative-leaning Anthropic option; compare with Sonnet 5 for craft polish.",
    adapterReady: true
  }),
  entry({
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    label: "Claude Sonnet 4.5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Scene craft, voice-sensitive edits, and balanced agent work.",
    relativeStrength:
      "Usually the best default for prose quality among mid-tier options; between Haiku speed and Opus depth.",
    adapterReady: true
  }),
  entry({
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Fast brainstorming and light Q&A without spending hard.",
    relativeStrength:
      "Snappier than Sonnet/Opus; thinner on long-form literary nuance than Sonnet.",
    adapterReady: true
  }),
  entry({
    id: "claude-opus-4-5",
    provider: "anthropic",
    label: "Claude Opus 4.5",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "Hard editorial judgment, deep character/world questions.",
    relativeStrength:
      "Top-tier depth in this catalog; slower/costlier than Sonnet or GPT-4.1 for routine chat.",
    adapterReady: true
  }),
  entry({
    id: "claude-opus-4-8",
    provider: "anthropic",
    label: "Claude Opus 4.8",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "high",
    bestFor: "Deep Anthropic reasoning when Opus 4.8 is on your key.",
    relativeStrength: "Opus-class depth; prefer Opus 5 when both appear in discovery.",
    adapterReady: true
  }),
  entry({
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Balanced Anthropic craft help on the 4.6 Sonnet line.",
    relativeStrength: "Sonnet-class prose; prefer Sonnet 5 when available.",
    adapterReady: true
  }),

  // Wave A — Google
  entry({
    id: "gemini-3-flash-preview",
    provider: "google",
    label: "Gemini 3 Flash Preview",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Newest Gemini flash-tier speed when preview is unlocked.",
    relativeStrength: "Fast Gemini preview; quality can trail Pro / Sonnet on subtle craft.",
    adapterReady: true
  }),
  entry({
    id: "gemini-2.5-pro",
    provider: "google",
    label: "Gemini 2.5 Pro",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Long-context project research and structured planning.",
    relativeStrength:
      "Strong with large manuscript slices; prose voice often trails Sonnet for fiction polish.",
    adapterReady: true
  }),
  entry({
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Quick research passes and cheap long-context skims.",
    relativeStrength:
      "Faster than Gemini Pro; less careful than Sonnet or GPT-4.1 on subtle craft notes.",
    adapterReady: true
  }),
  entry({
    id: "gemini-2.0-flash",
    provider: "google",
    label: "Gemini 2.0 Flash",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Low-latency chat when you already prefer Gemini.",
    relativeStrength:
      "Older/faster Gemini tier; prefer 2.5 Flash/Pro when quality matters more.",
    adapterReady: true
  }),

  // Wave B — Groq, xAI, Mistral, DeepSeek, OpenRouter
  entry({
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Very fast open-weight chat via Groq.",
    relativeStrength:
      "Speed king for open models; quality usually behind Sonnet / GPT-4.1 / Gemini Pro.",
    adapterReady: true
  }),
  entry({
    id: "grok-3-mini",
    provider: "xai",
    label: "Grok 3 Mini",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "fast",
    bestFor: "Quick alternate takes and informal brainstorming.",
    relativeStrength:
      "Lighter than frontier Opus/Pro models; useful as a second opinion, not the final editor.",
    adapterReady: true
  }),
  entry({
    id: "mistral-large-latest",
    provider: "mistral",
    label: "Mistral Large",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Capable European-hosted alternative for general writing help.",
    relativeStrength:
      "Competitive mid/high tier; often a step below Opus/Sonnet on literary nuance.",
    adapterReady: true
  }),
  entry({
    id: "deepseek-chat",
    provider: "deepseek",
    label: "DeepSeek Chat",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    bestFor: "Cost-efficient reasoning-friendly chat.",
    relativeStrength:
      "Strong value; may need more steering than Sonnet for voice-sensitive prose.",
    adapterReady: true
  }),
  entry({
    id: "openrouter/auto",
    provider: "openrouter",
    label: "OpenRouter Auto",
    supportsChat: true,
    supportsTools: true,
    supportsStructured: true,
    supportsImage: false,
    defaultEffort: "standard",
    notes: "Routes via OpenRouter to an available upstream model.",
    bestFor: "Trying long-tail models through one OpenRouter key.",
    relativeStrength:
      "Quality varies by routed upstream; prefer a named lab model when you care about consistency.",
    adapterReady: true
  })
]);

const CATALOG_BY_ID = new Map(MODEL_CATALOG.map((model) => [model.id, model]));

export const AGENT_MODEL_IDS: readonly string[] = Object.freeze(
  MODEL_CATALOG.map((model) => model.id)
);

/** Retired Ghostwriter-internal aliases that must never be accepted as upstream model ids. */
const RETIRED_GHOSTWRITER_MODEL_ALIASES = Object.freeze(
  new Set(["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"])
);

/** Default chat/structured model for capture reflection and similar workflows. */
export const CAPTURE_REFLECTION_DEFAULT_MODEL = "gpt-4.1";

/** Default cheap structured model for ambient next-action coach runs. */
export const NEXT_ACTION_COACH_DEFAULT_MODEL = "claude-haiku-4-5" as const;

/** Default catalog id for OpenAI Images generation. */
export const DEFAULT_IMAGE_MODEL_ID = "gpt-image-1";

export function getModelCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  return CATALOG_BY_ID.get(modelId.trim());
}

export function isCuratedModelId(value: string): boolean {
  return CATALOG_BY_ID.has(value.trim());
}

/**
 * Plausible upstream model id for request/receipt boundaries.
 * Availability for an account is enforced separately via discovery merge.
 */
export function isAgentModelId(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) return false;
  if (RETIRED_GHOSTWRITER_MODEL_ALIASES.has(normalized)) return false;
  if (/\s/.test(normalized)) return false;
  return true;
}

export function assertAgentModelId(value: string): string {
  const normalized = value.trim();
  if (!isAgentModelId(normalized)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent model id is not valid."
    );
  }
  return normalized;
}

export function requireModelCatalogEntry(modelId: string): ModelCatalogEntry {
  const entry = getModelCatalogEntry(modelId);
  if (entry === undefined) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Agent model is not in the Ghostwriter catalog."
    );
  }
  return entry;
}

export function agentEgressClassForProvider(provider: ProviderId): AgentEgressClass {
  switch (provider) {
    case "openai":
      return "openai-responses";
    case "anthropic":
      return "anthropic-messages";
    case "google":
      return "google-generate";
    case "groq":
    case "xai":
    case "mistral":
    case "deepseek":
    case "openrouter":
      return "openai-compatible";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Best-effort provider inference for discovered upstream ids. */
export function inferProviderForModelId(modelId: string): ProviderId | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  if (normalized.startsWith("claude")) return "anthropic";
  if (
    normalized.startsWith("gemini") ||
    normalized.startsWith("gemma") ||
    normalized.startsWith("models/gemini") ||
    normalized.startsWith("models/gemma")
  ) {
    return "google";
  }
  if (
    normalized.startsWith("gpt") ||
    normalized.startsWith("chatgpt") ||
    normalized.startsWith("dall-e") ||
    /^o[1-9](?:[-.]|$)/.test(normalized)
  ) {
    return "openai";
  }
  if (normalized.startsWith("llama") || normalized.includes("groq")) return "groq";
  if (normalized.startsWith("grok")) return "xai";
  if (normalized.startsWith("mistral") || normalized.startsWith("open-mistral")) {
    return "mistral";
  }
  if (normalized.startsWith("deepseek")) return "deepseek";
  if (normalized.includes("/")) return "openrouter";
  return undefined;
}

export function providerForAgentModel(modelId: string): ProviderId {
  const curated = getModelCatalogEntry(modelId);
  if (curated !== undefined) {
    return curated.provider;
  }
  const stem = stripDateSuffix(modelId.trim());
  const stemEntry = getModelCatalogEntry(stem);
  if (stemEntry !== undefined) {
    return stemEntry.provider;
  }
  const inferred = inferProviderForModelId(modelId);
  if (inferred !== undefined) {
    return inferred;
  }
  throw new DomainValidationError(
    "INVALID_AGENT_POLICY",
    "Agent model provider could not be resolved."
  );
}

/** Resolve provider from a merged available-models list (preferred for discovered ids). */
export function providerForAvailableModel(
  modelId: string,
  available: readonly Readonly<{ id: string; provider: ProviderId }>[]
): ProviderId | undefined {
  const normalized = modelId.trim();
  const hit = available.find((entry) => entry.id === normalized);
  if (hit !== undefined) {
    return hit.provider;
  }
  try {
    return providerForAgentModel(normalized);
  } catch {
    return undefined;
  }
}

export function modelsForProvider(providerId: ProviderId): readonly ModelCatalogEntry[] {
  const provider = assertProviderId(providerId);
  return Object.freeze(MODEL_CATALOG.filter((model) => model.provider === provider));
}

export type DiscoveredModelForMerge = Readonly<{
  id: string;
  displayName?: string;
  modelClass: "chat" | "image";
  supportsImage: boolean;
}>;

function stripDateSuffix(id: string): string {
  return id.replace(/-\d{8}$/, "");
}

export function prettifyModelId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed
    .split(/[/]/)
    .map((segment) =>
      segment
        .split("-")
        .map((part) => {
          if (/^\d/.test(part) || /^o\d/i.test(part)) return part;
          if (part.toLowerCase() === "gpt") return "GPT";
          if (part.toLowerCase() === "tts") return "TTS";
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(" ")
        .replace(/(\d) (\d)/g, "$1.$2")
    )
    .join(" / ");
}

function findCuratedMatch(
  modelId: string,
  provider: ProviderId
): ModelCatalogEntry | undefined {
  const direct = getModelCatalogEntry(modelId);
  if (direct !== undefined && direct.provider === provider) {
    return direct;
  }
  const stem = stripDateSuffix(modelId);
  if (stem !== modelId) {
    const stemEntry = getModelCatalogEntry(stem);
    if (stemEntry !== undefined && stemEntry.provider === provider) {
      return stemEntry;
    }
  }
  return undefined;
}

function synthesizeDiscoveredEntry(input: Readonly<{
  provider: ProviderId;
  discovered: DiscoveredModelForMerge;
}>): ModelCatalogEntry {
  const chat = input.discovered.modelClass === "chat";
  const image =
    input.discovered.modelClass === "image" || input.discovered.supportsImage;
  const label =
    input.discovered.displayName?.trim() ||
    prettifyModelId(input.discovered.id);
  return entry({
    id: input.discovered.id,
    provider: input.provider,
    label,
    supportsChat: chat,
    supportsTools: chat,
    supportsStructured: chat,
    supportsImage: image,
    ...(chat ? { defaultEffort: "standard" as const } : {}),
    bestFor: chat
      ? "Discovered on your provider key; try it for project chat."
      : "Discovered image model on your provider key.",
    relativeStrength: "Live discovery entry; curated highlights may describe close peers.",
    adapterReady: true
  });
}

/**
 * Merge live discovery with curated catalog metadata.
 * Curated wins for metadata when ids match (including date-suffix stems).
 * Date-suffixed discovery ids that match a curated stem collapse onto the curated
 * id so the picker does not show duplicate labels (e.g. claude-haiku-4-5 + …-20251001).
 * Discovered-only ids are synthesized with adapter-ready defaults.
 */
export function mergeDiscoveredModels(input: Readonly<{
  provider: ProviderId;
  curated?: readonly ModelCatalogEntry[];
  discovered: readonly DiscoveredModelForMerge[];
}>): ModelCatalogEntry[] {
  const provider = assertProviderId(input.provider);
  const curatedForProvider = (input.curated ?? MODEL_CATALOG).filter(
    (model) => model.provider === provider
  );
  const byId = new Map<string, ModelCatalogEntry>();

  for (const discovered of input.discovered) {
    const id = discovered.id.trim();
    if (id.length === 0) continue;
    const curatedMatch = findCuratedMatch(id, provider);
    if (curatedMatch !== undefined) {
      const canonicalId = curatedMatch.id;
      // Prefer an exact curated-id hit over a later dated snapshot of the same stem.
      if (byId.has(canonicalId) && id !== canonicalId) {
        continue;
      }
      const chat = discovered.modelClass === "chat";
      const image =
        discovered.modelClass === "image" ||
        discovered.supportsImage ||
        curatedMatch.supportsImage;
      byId.set(
        canonicalId,
        entry({
          ...curatedMatch,
          id: canonicalId,
          label: curatedMatch.label,
          supportsChat: chat ? true : curatedMatch.supportsChat,
          supportsTools: chat ? true : curatedMatch.supportsTools,
          supportsStructured: chat ? true : curatedMatch.supportsStructured,
          supportsImage: image,
          adapterReady: true
        })
      );
      continue;
    }
    byId.set(
      id,
      synthesizeDiscoveredEntry({
        provider,
        discovered: { ...discovered, id }
      })
    );
  }

  // Keep curated highlights that discovery missed (still useful when listing fails partially).
  for (const curated of curatedForProvider) {
    if (!byId.has(curated.id) && curated.adapterReady) {
      byId.set(curated.id, curated);
    }
  }

  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export type AvailableModelCatalogProvider = Readonly<{
  provider: ProviderId;
  configured: boolean;
  validationState?: import("./provider-credentials.js").ProviderCredentialValidationState;
  version?: number;
  maskedHint?: string;
  createdAt?: string;
  updatedAt?: string;
  validatedAt?: string;
}>;

export type ModelDiscoveryStatus = Readonly<{
  provider: ProviderId;
  ok: boolean;
  count: number;
  errorCode?: string;
}>;

export type AvailableModelCatalogView = Readonly<{
  models: readonly ModelCatalogEntry[];
  providers: readonly AvailableModelCatalogProvider[];
  discovery?: readonly ModelDiscoveryStatus[];
}>;

function isReachableCredentialState(
  state: import("./provider-credentials.js").ProviderCredentialValidationState
): boolean {
  return state === "unvalidated" || state === "valid" || state === "invalid";
}

/**
 * Intersect the curated catalog with account credentials.
 * A provider is reachable when a non-revoked credential exists (picker works before validate).
 */
export function availableModelsForCredentials(
  configured: readonly Readonly<{
    provider: ProviderId;
    validationState: import("./provider-credentials.js").ProviderCredentialValidationState;
    version: number;
    maskedHint: string;
    createdAt: string;
    updatedAt: string;
    validatedAt?: string;
  }>[]
): AvailableModelCatalogView {
  const byProvider = new Map(configured.map((status) => [status.provider, status] as const));
  const reachableProviders = new Set(
    [...byProvider.entries()]
      .filter(([, status]) => isReachableCredentialState(status.validationState))
      .map(([provider]) => provider)
  );

  const models = MODEL_CATALOG.filter((model) => reachableProviders.has(model.provider));

  const providers: AvailableModelCatalogProvider[] = PROVIDER_IDS.map((providerId) => {
    const status = byProvider.get(providerId);
    if (status === undefined) {
      return Object.freeze({
        provider: providerId,
        configured: false as const
      });
    }
    return Object.freeze({
      provider: providerId,
      configured: true as const,
      validationState: status.validationState,
      version: status.version,
      maskedHint: status.maskedHint,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      ...(status.validatedAt === undefined ? {} : { validatedAt: status.validatedAt })
    });
  });

  return Object.freeze({
    models: Object.freeze(models),
    providers: Object.freeze(providers)
  });
}
