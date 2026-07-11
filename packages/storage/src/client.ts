import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { Pool, type PoolConfig } from "pg";
import { ghostwriterSchema, type GhostwriterSchema } from "./schema.js";

/**
 * The repository adapter is written against the node-postgres database type. PGlite (see
 * `./pglite.ts`, used only by tests and local dev) exposes the same runtime query-builder
 * surface, so callers convert their PGlite instance through {@link toRepositoryDatabase}. This
 * keeps the adapter monomorphic and fully typed, and keeps the WASM PGlite dependency out of the
 * production backend bundle.
 */
export type RepositoryDatabase = NodePgDatabase<GhostwriterSchema>;
export type PgliteRepositoryDatabase = PgliteDatabase<GhostwriterSchema>;

export type NodePostgresConnection = Readonly<{
  db: RepositoryDatabase;
  pool: Pool;
  close(): Promise<void>;
}>;

export function createNodePostgresDatabase(config: PoolConfig): NodePostgresConnection {
  const pool = new Pool(config);
  const db = drizzleNode(pool, { schema: ghostwriterSchema });

  return Object.freeze({
    db,
    pool,
    close: () => pool.end()
  });
}

export function toRepositoryDatabase(db: PgliteRepositoryDatabase): RepositoryDatabase {
  return db as unknown as RepositoryDatabase;
}
