import type { DiscoveredModel } from "./types.js";

export type OpenAiStyleModelsPage = Readonly<{
  data?: readonly Readonly<{ id?: unknown; owned_by?: unknown }>[] | unknown;
  object?: unknown;
  has_more?: unknown;
  last_id?: unknown;
}>;

export type AnthropicModelsPage = Readonly<{
  data?: readonly Readonly<{
    id?: unknown;
    display_name?: unknown;
    type?: unknown;
  }>[] | unknown;
  first_id?: unknown;
  last_id?: unknown;
  has_more?: unknown;
}>;

export type GoogleModelsPage = Readonly<{
  models?: readonly Readonly<{
    name?: unknown;
    displayName?: unknown;
    supportedGenerationMethods?: unknown;
  }>[] | unknown;
  nextPageToken?: unknown;
}>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Parse OpenAI / OpenAI-compatible `GET /v1/models` JSON into discovered models. */
export function parseOpenAiStyleModelsResponse(body: unknown): readonly DiscoveredModel[] {
  const page = asRecord(body) as OpenAiStyleModelsPage | undefined;
  const data = page?.data;
  if (!Array.isArray(data)) {
    return Object.freeze([]);
  }
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const id = stringField(record?.id);
    if (id === undefined) continue;
    models.push(Object.freeze({ id, raw: item }));
  }
  return Object.freeze(models);
}

export function openAiStyleModelsHasMore(body: unknown): boolean {
  const page = asRecord(body) as OpenAiStyleModelsPage | undefined;
  return page?.has_more === true;
}

export function openAiStyleModelsLastId(body: unknown): string | undefined {
  const page = asRecord(body) as OpenAiStyleModelsPage | undefined;
  return stringField(page?.last_id);
}

/** Parse Anthropic `GET /v1/models` JSON (paginated). */
export function parseAnthropicModelsResponse(body: unknown): readonly DiscoveredModel[] {
  const page = asRecord(body) as AnthropicModelsPage | undefined;
  const data = page?.data;
  if (!Array.isArray(data)) {
    return Object.freeze([]);
  }
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const id = stringField(record?.id);
    if (id === undefined) continue;
    const displayName = stringField(record?.display_name);
    models.push(
      Object.freeze({
        id,
        ...(displayName === undefined ? {} : { displayName }),
        raw: item
      })
    );
  }
  return Object.freeze(models);
}

export function anthropicModelsHasMore(body: unknown): boolean {
  const page = asRecord(body) as AnthropicModelsPage | undefined;
  return page?.has_more === true;
}

export function anthropicModelsLastId(body: unknown): string | undefined {
  const page = asRecord(body) as AnthropicModelsPage | undefined;
  return stringField(page?.last_id);
}

/** Strip Google `models/` prefix from resource names. */
export function stripGoogleModelPrefix(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

/** Parse Google `GET /v1beta/models` JSON (paginated). */
export function parseGoogleModelsResponse(body: unknown): readonly DiscoveredModel[] {
  const page = asRecord(body) as GoogleModelsPage | undefined;
  const modelsField = page?.models;
  if (!Array.isArray(modelsField)) {
    return Object.freeze([]);
  }
  const models: DiscoveredModel[] = [];
  for (const item of modelsField) {
    const record = asRecord(item);
    const name = stringField(record?.name);
    if (name === undefined) continue;
    const id = stripGoogleModelPrefix(name);
    if (id.length === 0) continue;
    const displayName = stringField(record?.displayName);
    models.push(
      Object.freeze({
        id,
        ...(displayName === undefined ? {} : { displayName }),
        raw: item
      })
    );
  }
  return Object.freeze(models);
}

export function googleModelsNextPageToken(body: unknown): string | undefined {
  const page = asRecord(body) as GoogleModelsPage | undefined;
  return stringField(page?.nextPageToken);
}

export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

const MAX_MODEL_LIST_PAGES = 20;

export async function fetchPaginatedOpenAiStyleModels(input: Readonly<{
  fetchImpl: typeof fetch;
  initialUrl: string;
  headers: HeadersInit;
  signal?: AbortSignal;
  /** When true, follow `has_more` + `last_id` query pagination. */
  paginate?: boolean;
}>): Promise<readonly DiscoveredModel[]> {
  const collected: DiscoveredModel[] = [];
  let url = input.initialUrl;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    if (input.signal?.aborted) {
      break;
    }
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: input.headers,
      signal: input.signal
    });
    if (!response.ok) {
      throw new ModelListingHttpError(response.status);
    }
    const body = await readJsonBody(response);
    collected.push(...parseOpenAiStyleModelsResponse(body));
    if (!input.paginate || !openAiStyleModelsHasMore(body)) {
      break;
    }
    const lastId = openAiStyleModelsLastId(body);
    if (lastId === undefined) {
      break;
    }
    const separator = url.includes("?") ? "&" : "?";
    // Replace prior after_id if present by rebuilding from initial URL.
    const base = input.initialUrl.split("?")[0]!;
    url = `${base}?after_id=${encodeURIComponent(lastId)}`;
    void separator;
  }
  return Object.freeze(collected);
}

export async function fetchPaginatedAnthropicModels(input: Readonly<{
  fetchImpl: typeof fetch;
  baseModelsUrl: string;
  headers: HeadersInit;
  signal?: AbortSignal;
}>): Promise<readonly DiscoveredModel[]> {
  const collected: DiscoveredModel[] = [];
  let url = input.baseModelsUrl;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    if (input.signal?.aborted) {
      break;
    }
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: input.headers,
      signal: input.signal
    });
    if (!response.ok) {
      throw new ModelListingHttpError(response.status);
    }
    const body = await readJsonBody(response);
    collected.push(...parseAnthropicModelsResponse(body));
    if (!anthropicModelsHasMore(body)) {
      break;
    }
    const lastId = anthropicModelsLastId(body);
    if (lastId === undefined) {
      break;
    }
    const base = input.baseModelsUrl.split("?")[0]!;
    url = `${base}?after_id=${encodeURIComponent(lastId)}`;
  }
  return Object.freeze(collected);
}

export async function fetchPaginatedGoogleModels(input: Readonly<{
  fetchImpl: typeof fetch;
  /** Base URL including `?key=` (or other query). */
  baseModelsUrl: string;
  signal?: AbortSignal;
}>): Promise<readonly DiscoveredModel[]> {
  const collected: DiscoveredModel[] = [];
  let url = input.baseModelsUrl;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    if (input.signal?.aborted) {
      break;
    }
    const response = await input.fetchImpl(url, {
      method: "GET",
      signal: input.signal
    });
    if (!response.ok) {
      throw new ModelListingHttpError(response.status);
    }
    const body = await readJsonBody(response);
    collected.push(...parseGoogleModelsResponse(body));
    const nextToken = googleModelsNextPageToken(body);
    if (nextToken === undefined) {
      break;
    }
    const separator = input.baseModelsUrl.includes("?") ? "&" : "?";
    url = `${input.baseModelsUrl}${separator}pageToken=${encodeURIComponent(nextToken)}`;
  }
  return Object.freeze(collected);
}

export class ModelListingHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Model listing failed with HTTP ${status}.`);
    this.name = "ModelListingHttpError";
    this.status = status;
  }
}
