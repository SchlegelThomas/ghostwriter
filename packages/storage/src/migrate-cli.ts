import type { PoolConfig } from "pg";
import { createNodePostgresDatabase } from "./client.js";
import { migrateRepositoryDatabase } from "./migrate.js";

function sslConfig(): PoolConfig["ssl"] {
  const requested =
    process.env.DATABASE_SSL === "require" || process.env.PGSSLMODE === "require";
  return requested ? { rejectUnauthorized: false } : undefined;
}

function resolveConfig(): PoolConfig | undefined {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString !== undefined && connectionString.length > 0) {
    return { connectionString, ssl: sslConfig() };
  }

  // Fall back to standard PG* environment variables (used by the Lakebase CLI flow, which injects
  // a short-lived OAuth token as PGPASSWORD). node-postgres reads PGHOST/PGUSER/PGPASSWORD/etc.
  if (process.env.PGHOST !== undefined && process.env.PGHOST.length > 0) {
    return { ssl: sslConfig() };
  }

  return undefined;
}

async function main(): Promise<void> {
  const config = resolveConfig();

  if (config === undefined) {
    console.error("Set DATABASE_URL or PGHOST (+ PG* vars) to run migrations.");
    process.exitCode = 1;
    return;
  }

  const { db, close } = createNodePostgresDatabase(config);

  try {
    await migrateRepositoryDatabase(db);
    console.log("Ghostwriter migrations applied.");
  } finally {
    await close();
  }
}

await main();
