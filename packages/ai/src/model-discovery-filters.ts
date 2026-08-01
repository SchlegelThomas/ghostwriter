import type { DiscoveredModel } from "./types.js";

export type DiscoveredModelClass = "chat" | "image";

export type FilteredDiscoveredModel = Readonly<{
  id: string;
  displayName?: string;
  modelClass: DiscoveredModelClass;
  /** Google / OpenAI image-capable chat variants. */
  supportsImage: boolean;
}>;

const OPENAI_CHAT_NOISE =
  /(?:realtime|audio|transcribe|tts|search|instruct|whisper|moderation|embedding|davinci|babbage|ada|curie|tts-|gpt-3\.5)/i;

function withDisplayName(
  model: DiscoveredModel,
  modelClass: DiscoveredModelClass,
  supportsImage: boolean
): FilteredDiscoveredModel {
  return Object.freeze({
    id: model.id,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
    modelClass,
    supportsImage
  });
}

/** OpenAI chat: gpt-*, o1/o3/o4*, chatgpt-* excluding realtime/audio/… noise. */
export function isOpenAiChatDiscoverableId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (OPENAI_CHAT_NOISE.test(normalized)) return false;
  if (normalized.includes("image") || normalized.startsWith("dall-e")) return false;
  if (normalized.startsWith("gpt-")) return true;
  if (/^o[1-9](?:[-.]|$)/.test(normalized)) return true;
  if (normalized.startsWith("chatgpt-")) return true;
  return false;
}

/** OpenAI image: *image*, dall-e-*. */
export function isOpenAiImageDiscoverableId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (normalized.includes("embedding")) return false;
  if (normalized.startsWith("dall-e")) return true;
  if (normalized.includes("image")) return true;
  return false;
}

export function filterOpenAiDiscoveredModels(
  models: readonly DiscoveredModel[]
): readonly FilteredDiscoveredModel[] {
  const out: FilteredDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (seen.has(id)) continue;
    if (isOpenAiImageDiscoverableId(id)) {
      seen.add(id);
      out.push(withDisplayName(model, "image", true));
      continue;
    }
    if (isOpenAiChatDiscoverableId(id)) {
      seen.add(id);
      out.push(withDisplayName(model, "chat", false));
    }
  }
  return Object.freeze(out);
}

/** Anthropic: keep all /v1/models ids as chat. */
export function filterAnthropicDiscoveredModels(
  models: readonly DiscoveredModel[]
): readonly FilteredDiscoveredModel[] {
  const out: FilteredDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(withDisplayName({ ...model, id }, "chat", false));
  }
  return Object.freeze(out);
}

const GOOGLE_EXCLUDE =
  /(?:^|[-_.])(?:tts|lyria|robotics|deep-research|embedding|aqa|gecko)(?:$|[-_.])/i;

function googleSupportsGenerateContent(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const methods = (raw as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;
  if (!Array.isArray(methods)) return false;
  return methods.some((method) => method === "generateContent");
}

function isGoogleImageId(id: string): boolean {
  return id.toLowerCase().includes("image");
}

export function filterGoogleDiscoveredModels(
  models: readonly DiscoveredModel[]
): readonly FilteredDiscoveredModel[] {
  const out: FilteredDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    if (!googleSupportsGenerateContent(model.raw)) continue;
    if (GOOGLE_EXCLUDE.test(id)) continue;
    const image = isGoogleImageId(id);
    seen.add(id);
    out.push(withDisplayName({ ...model, id }, image ? "image" : "chat", image));
  }
  return Object.freeze(out);
}

const COMPAT_EMBED = /embed/i;

/** OpenAI-compatible: keep ids that look like chat models (exclude embed). */
export function filterOpenAiCompatibleDiscoveredModels(
  models: readonly DiscoveredModel[]
): readonly FilteredDiscoveredModel[] {
  const out: FilteredDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    if (COMPAT_EMBED.test(id)) continue;
    seen.add(id);
    out.push(withDisplayName({ ...model, id }, "chat", false));
  }
  return Object.freeze(out);
}

export function filterDiscoveredModelsForProvider(
  provider:
    | "openai"
    | "anthropic"
    | "google"
    | "groq"
    | "xai"
    | "mistral"
    | "deepseek"
    | "openrouter",
  models: readonly DiscoveredModel[]
): readonly FilteredDiscoveredModel[] {
  switch (provider) {
    case "openai":
      return filterOpenAiDiscoveredModels(models);
    case "anthropic":
      return filterAnthropicDiscoveredModels(models);
    case "google":
      return filterGoogleDiscoveredModels(models);
    case "groq":
    case "xai":
    case "mistral":
    case "deepseek":
    case "openrouter":
      return filterOpenAiCompatibleDiscoveredModels(models);
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
