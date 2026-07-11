import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePostgresConnection } from "./client.js";
import { ghostwriterSchema } from "./schema.js";

/**
 * Connects the long-running backend to Lakebase using the CI/app service principal (OAuth M2M).
 * Lakebase database credentials are short-lived (~1h), so we mint a fresh one on demand and cache
 * it until shortly before expiry. This avoids static-token expiry without relying on workspace PATs.
 */
export type LakebaseConnectionConfig = Readonly<{
  databricksHost: string;
  clientId: string;
  clientSecret: string;
  project: string;
  branch: string;
  endpointId: string;
  pgHost: string;
  pgUser: string;
  database: string;
}>;

type CachedToken = Readonly<{ token: string; expiresAtMs: number }>;

async function mintAccessToken(config: LakebaseConnectionConfig): Promise<string> {
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.databricksHost}/oidc/v1/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" })
  });

  if (!response.ok) {
    throw new Error(`Databricks OIDC token request failed: ${response.status}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (body.access_token === undefined) {
    throw new Error("Databricks OIDC response did not include an access_token.");
  }

  return body.access_token;
}

async function mintDatabaseToken(config: LakebaseConnectionConfig): Promise<CachedToken> {
  const accessToken = await mintAccessToken(config);
  const endpoint = `projects/${config.project}/branches/${config.branch}/endpoints/${config.endpointId}`;
  const response = await fetch(`${config.databricksHost}/api/2.0/postgres/credentials`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ endpoint })
  });

  if (!response.ok) {
    throw new Error(`Lakebase credential request failed: ${response.status}`);
  }

  const body = (await response.json()) as { token?: string; expire_time?: string };
  if (body.token === undefined) {
    throw new Error("Lakebase credential response did not include a token.");
  }

  const expiresAtMs =
    body.expire_time === undefined ? Date.now() + 55 * 60 * 1000 : Date.parse(body.expire_time);

  return { token: body.token, expiresAtMs };
}

export function createLakebaseConnection(
  config: LakebaseConnectionConfig
): NodePostgresConnection {
  let cached: CachedToken | undefined;
  let inflight: Promise<CachedToken> | undefined;

  async function password(): Promise<string> {
    if (cached !== undefined && cached.expiresAtMs - 60_000 > Date.now()) {
      return cached.token;
    }

    inflight ??= mintDatabaseToken(config).finally(() => {
      inflight = undefined;
    });
    cached = await inflight;
    return cached.token;
  }

  const pool = new Pool({
    host: config.pgHost,
    port: 5432,
    user: config.pgUser,
    database: config.database,
    ssl: { rejectUnauthorized: false },
    password
  });
  const db = drizzleNode(pool, { schema: ghostwriterSchema });

  return Object.freeze({
    db,
    pool,
    close: () => pool.end()
  });
}
