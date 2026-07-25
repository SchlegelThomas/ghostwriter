export const PROVIDER_KEK_CONFIG_ERROR =
  "Provider encryption key configuration is invalid." as const;

const PROVIDER_KEK_ENV_PREFIX = "GHOSTWRITER_PROVIDER_KEK_" as const;
const PROVIDER_KEK_ACTIVE_ENV = "GHOSTWRITER_PROVIDER_KEK_ACTIVE" as const;
const KEK_VERSION_PATTERN = /^V\d+$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const KEK_BYTE_LENGTH = 32;

export type ProviderKekRuntimeConfig = Readonly<{
  keys: ReadonlyMap<string, Buffer>;
  activeVersion: string;
}>;

function parseBooleanEnv(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(PROVIDER_KEK_CONFIG_ERROR);
}

export function parseProviderCallsDisabled(env: NodeJS.ProcessEnv): boolean {
  return parseBooleanEnv(env.GHOSTWRITER_PROVIDER_CALLS_DISABLED);
}

function parseKekMaterial(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !BASE64_PATTERN.test(trimmed)) {
    throw new Error(PROVIDER_KEK_CONFIG_ERROR);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error(PROVIDER_KEK_CONFIG_ERROR);
  }
  if (decoded.length !== KEK_BYTE_LENGTH) {
    throw new Error(PROVIDER_KEK_CONFIG_ERROR);
  }
  return decoded;
}

export function parseProviderKekConfig(
  env: NodeJS.ProcessEnv
): ProviderKekRuntimeConfig | undefined {
  const kekEntries: Array<readonly [string, string]> = [];
  for (const [key, rawValue] of Object.entries(env)) {
    if (!key.startsWith(PROVIDER_KEK_ENV_PREFIX) || key === PROVIDER_KEK_ACTIVE_ENV) {
      continue;
    }
    if (rawValue === undefined || rawValue.length === 0) {
      continue;
    }
    const version = key.slice(PROVIDER_KEK_ENV_PREFIX.length);
    if (!KEK_VERSION_PATTERN.test(version)) {
      throw new Error(PROVIDER_KEK_CONFIG_ERROR);
    }
    kekEntries.push([version, rawValue] as const);
  }

  const activeRaw = env[PROVIDER_KEK_ACTIVE_ENV];
  const active =
    activeRaw === undefined || activeRaw.trim().length === 0
      ? undefined
      : activeRaw.trim();

  if (kekEntries.length === 0) {
    if (active !== undefined) {
      throw new Error(PROVIDER_KEK_CONFIG_ERROR);
    }
    return undefined;
  }

  if (active === undefined || !KEK_VERSION_PATTERN.test(active)) {
    throw new Error(PROVIDER_KEK_CONFIG_ERROR);
  }

  const keys = new Map<string, Buffer>();
  for (const [version, material] of kekEntries) {
    if (keys.has(version)) {
      throw new Error(PROVIDER_KEK_CONFIG_ERROR);
    }
    keys.set(version, parseKekMaterial(material));
  }

  if (!keys.has(active)) {
    throw new Error(PROVIDER_KEK_CONFIG_ERROR);
  }

  return Object.freeze({
    keys: Object.freeze(new Map(keys)),
    activeVersion: active
  });
}

/** Deterministic 32-byte KEK for PGlite and unit tests. */
export function createTestProviderKekRuntimeConfig(): ProviderKekRuntimeConfig {
  const key = Buffer.alloc(KEK_BYTE_LENGTH, 0x27);
  return Object.freeze({
    keys: Object.freeze(new Map([["V1", key]] as const)),
    activeVersion: "V1"
  });
}

export function providerKekEnvFromConfig(
  config: ProviderKekRuntimeConfig
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GHOSTWRITER_PROVIDER_KEK_ACTIVE: config.activeVersion
  };
  for (const [version, key] of config.keys.entries()) {
    env[`${PROVIDER_KEK_ENV_PREFIX}${version}`] = key.toString("base64");
  }
  return env;
}
