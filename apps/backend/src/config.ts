import type { LakebaseConnectionConfig } from "@ghostwriter/storage";

export type DatabaseConfig =
  | Readonly<{ mode: "url"; connectionString: string; ssl: boolean }>
  | Readonly<{ mode: "lakebase"; lakebase: LakebaseConnectionConfig }>;

export type BackendConfig = Readonly<{
  port: number;
  database: DatabaseConfig;
  auth: Readonly<{
    baseUrl: string;
    secret: string;
    googleClientId: string;
    googleClientSecret: string;
    trustedOrigins: readonly string[];
    secureCookies: boolean;
  }>;
}>;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function parseOrigin(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute http(s) URL.`);
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
    throw new Error(`${key} must be an origin without a path, query, or fragment.`);
  }

  return url.origin;
}

/** Exact origins or Better Auth wildcard patterns such as https://*.example.pages.dev. */
function parseTrustedOrigin(value: string, key: string): string {
  if (!value.includes("*")) {
    return parseOrigin(value, key);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute http(s) origin pattern.`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      `${key} wildcard entries must be origins without a path, query, or fragment.`
    );
  }

  return url.origin;
}

export function pagesPreviewCookieDomain(baseUrl: string): string | undefined {
  const host = new URL(baseUrl).hostname;
  // Cloudflare Pages project host is registrable; branch aliases are subdomains of it.
  if (!host.endsWith(".pages.dev") || host.split(".").length < 3) {
    return undefined;
  }
  return `.${host}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const port = Number.parseInt(env.PORT ?? "8787", 10);
  if (Number.isNaN(port)) {
    throw new Error(`PORT must be a number, received "${env.PORT ?? ""}".`);
  }

  const baseUrl = parseOrigin(required(env, "BETTER_AUTH_URL"), "BETTER_AUTH_URL");
  const trustedOrigins = (env.AUTH_TRUSTED_ORIGINS ?? baseUrl)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => parseTrustedOrigin(origin, "AUTH_TRUSTED_ORIGINS"));
  const authSecret = required(env, "BETTER_AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  const auth = {
    baseUrl,
    secret: authSecret,
    googleClientId: required(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
    trustedOrigins: Object.freeze([...new Set([baseUrl, ...trustedOrigins])]),
    secureCookies: new URL(baseUrl).protocol === "https:"
  } as const;

  // Lakebase (service-principal OAuth) mode is selected when a client secret + PG host are present.
  if (
    env.DATABRICKS_CLIENT_SECRET !== undefined &&
    env.DATABRICKS_CLIENT_SECRET.length > 0 &&
    env.LAKEBASE_HOST !== undefined &&
    env.LAKEBASE_HOST.length > 0
  ) {
    return {
      port,
      auth,
      database: {
        mode: "lakebase",
        lakebase: {
          databricksHost: required(env, "DATABRICKS_HOST"),
          clientId: required(env, "DATABRICKS_CLIENT_ID"),
          clientSecret: required(env, "DATABRICKS_CLIENT_SECRET"),
          project: required(env, "LAKEBASE_PROJECT_ID"),
          branch: env.LAKEBASE_BRANCH ?? "production",
          endpointId: env.LAKEBASE_ENDPOINT_ID ?? "primary",
          pgHost: required(env, "LAKEBASE_HOST"),
          pgUser: required(env, "LAKEBASE_USER"),
          database: env.LAKEBASE_DB ?? "databricks_postgres"
        }
      }
    };
  }

  const connectionString = env.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error(
      "Set Lakebase env (DATABRICKS_CLIENT_SECRET + LAKEBASE_HOST + …) or DATABASE_URL to start the backend."
    );
  }

  return {
    port,
    auth,
    database: { mode: "url", connectionString, ssl: env.DATABASE_SSL === "require" }
  };
}
