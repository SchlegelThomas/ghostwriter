import type { LakebaseConnectionConfig } from "@ghostwriter/storage";

export type DatabaseConfig =
  | Readonly<{ mode: "url"; connectionString: string; ssl: boolean }>
  | Readonly<{ mode: "lakebase"; lakebase: LakebaseConnectionConfig }>;

export type BackendConfig = Readonly<{
  port: number;
  database: DatabaseConfig;
}>;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for Lakebase mode.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const port = Number.parseInt(env.PORT ?? "8787", 10);
  if (Number.isNaN(port)) {
    throw new Error(`PORT must be a number, received "${env.PORT ?? ""}".`);
  }

  // Lakebase (service-principal OAuth) mode is selected when a client secret + PG host are present.
  if (
    env.DATABRICKS_CLIENT_SECRET !== undefined &&
    env.DATABRICKS_CLIENT_SECRET.length > 0 &&
    env.LAKEBASE_HOST !== undefined &&
    env.LAKEBASE_HOST.length > 0
  ) {
    return {
      port,
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
    database: { mode: "url", connectionString, ssl: env.DATABASE_SSL === "require" }
  };
}
