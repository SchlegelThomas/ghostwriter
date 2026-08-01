import {
  combineAbortWithTimeout,
  createProviderAdapter,
  filterDiscoveredModelsForProvider,
  type AiProviderId,
  type DiscoveredModel,
  type ListingCredentialProvider
} from "@ghostwriter/ai";
import {
  availableModelsForCredentials,
  mergeDiscoveredModels,
  type AvailableModelCatalogView,
  type ModelCatalogEntry,
  type ModelDiscoveryStatus,
  type ProviderCredentialStatus,
  type ProviderId
} from "@ghostwriter/core";

export const MODEL_DISCOVERY_TIMEOUT_MS = 8_000;
export const MODEL_DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1_000;

export type ModelListFactory = (input: Readonly<{
  providerId: ProviderId;
  apiKey: string;
}>) => ListingCredentialProvider;

export type ModelDiscoveryCacheEntry = Readonly<{
  expiresAt: number;
  models: readonly ModelCatalogEntry[];
  discovery: readonly ModelDiscoveryStatus[];
}>;

const discoveryCache = new Map<string, ModelDiscoveryCacheEntry>();

export function clearModelDiscoveryCache(): void {
  discoveryCache.clear();
}

function cacheKey(input: Readonly<{
  accountId: string;
  provider: ProviderId;
  credentialVersion: number;
}>): string {
  return `${input.accountId}::${input.provider}::${input.credentialVersion}`;
}

function isReachable(
  state: ProviderCredentialStatus["validationState"]
): boolean {
  return state === "unvalidated" || state === "valid" || state === "invalid";
}

function errorCodeFromUnknown(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    if (status === 401 || status === 403) return "auth_failed";
    if (status === 429) return "rate_limited";
    return "upstream_error";
  }
  return "upstream_error";
}

export async function listModelsWithTimeout(input: Readonly<{
  provider: ListingCredentialProvider;
  timeoutMs?: number;
  signal?: AbortSignal;
}>): Promise<readonly DiscoveredModel[]> {
  const combined = combineAbortWithTimeout(
    input.signal,
    input.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS
  );
  try {
    return await input.provider.listModels(combined.signal);
  } finally {
    combined.dispose();
  }
}

export async function discoverModelsForAccount(input: Readonly<{
  accountId: string;
  configured: readonly ProviderCredentialStatus[];
  resolveApiKey: (providerId: ProviderId) => Promise<string>;
  createListingProvider?: ModelListFactory;
  nowMs?: number;
  timeoutMs?: number;
}>): Promise<AvailableModelCatalogView> {
  const now = input.nowMs ?? Date.now();
  const base = availableModelsForCredentials(input.configured);
  const createListing =
    input.createListingProvider ??
    ((factoryInput) =>
      createProviderAdapter({
        providerId: factoryInput.providerId as AiProviderId,
        apiKey: factoryInput.apiKey
      }));

  const reachable = input.configured.filter((status) =>
    isReachable(status.validationState)
  );

  const discoveryResults = await Promise.all(
    reachable.map(async (status) => {
      const key = cacheKey({
        accountId: input.accountId,
        provider: status.provider,
        credentialVersion: status.version
      });
      const cached = discoveryCache.get(key);
      if (cached !== undefined && cached.expiresAt > now) {
        return {
          provider: status.provider,
          models: cached.models,
          discovery: cached.discovery[0]!
        };
      }

      const curatedFallback = base.models.filter(
        (model) => model.provider === status.provider
      );

      try {
        const apiKey = await input.resolveApiKey(status.provider);
        const listing = createListing({
          providerId: status.provider,
          apiKey
        });
        const raw = await listModelsWithTimeout({
          provider: listing,
          timeoutMs: input.timeoutMs
        });
        const filtered = filterDiscoveredModelsForProvider(status.provider, raw);
        const merged = mergeDiscoveredModels({
          provider: status.provider,
          discovered: filtered
        });
        const discovery: ModelDiscoveryStatus = Object.freeze({
          provider: status.provider,
          ok: true,
          count: filtered.length
        });
        discoveryCache.set(
          key,
          Object.freeze({
            expiresAt: now + MODEL_DISCOVERY_CACHE_TTL_MS,
            models: Object.freeze(merged),
            discovery: Object.freeze([discovery])
          })
        );
        return {
          provider: status.provider,
          models: merged,
          discovery
        };
      } catch (error) {
        const discovery: ModelDiscoveryStatus = Object.freeze({
          provider: status.provider,
          ok: false,
          count: curatedFallback.length,
          errorCode: errorCodeFromUnknown(error)
        });
        // Short negative cache so failures do not stampede upstream.
        discoveryCache.set(
          key,
          Object.freeze({
            expiresAt: now + Math.min(60_000, MODEL_DISCOVERY_CACHE_TTL_MS),
            models: Object.freeze(curatedFallback),
            discovery: Object.freeze([discovery])
          })
        );
        return {
          provider: status.provider,
          models: curatedFallback,
          discovery
        };
      }
    })
  );

  const modelsById = new Map<string, ModelCatalogEntry>();
  for (const result of discoveryResults) {
    for (const model of result.models) {
      modelsById.set(model.id, model);
    }
  }

  const discovery = Object.freeze(
    discoveryResults.map((result) => result.discovery)
  );

  return Object.freeze({
    models: Object.freeze([...modelsById.values()].sort((a, b) =>
      a.label.localeCompare(b.label)
    )),
    providers: base.providers,
    discovery
  });
}
