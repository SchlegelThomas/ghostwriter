import { fileURLToPath } from "node:url";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import type { RepositoryDatabase } from "./client.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrateRepositoryDatabase(db: RepositoryDatabase): Promise<void> {
  await migrateNode(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
