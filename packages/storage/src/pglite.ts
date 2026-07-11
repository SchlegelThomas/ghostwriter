import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteRepositoryDatabase } from "./client.js";
import { MIGRATIONS_FOLDER } from "./migrate.js";
import { ghostwriterSchema } from "./schema.js";

/**
 * In-process Postgres for tests and local development. Not exported from the package entry point so
 * the production backend never bundles the PGlite WASM runtime.
 */
export type PgliteConnection = Readonly<{
  db: PgliteRepositoryDatabase;
  client: PGlite;
  close(): Promise<void>;
}>;

export function createPgliteDatabase(dataDir?: string): PgliteConnection {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  const db = drizzlePglite(client, { schema: ghostwriterSchema });

  return Object.freeze({
    db,
    client,
    close: () => client.close()
  });
}

export async function migratePgliteRepositoryDatabase(
  db: PgliteRepositoryDatabase
): Promise<void> {
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
