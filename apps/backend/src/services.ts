import { randomUUID } from "node:crypto";
import {
  createGhostwriterServices,
  type DomainIdKind,
  type GhostwriterServices
} from "@ghostwriter/core";
import {
  createLakebaseConnection,
  createNodePostgresDatabase,
  createPostgresProjectRepository,
  type NodePostgresConnection
} from "@ghostwriter/storage";
import type { BackendConfig } from "./config.js";

export type BackendRuntime = Readonly<{
  services: GhostwriterServices;
  close(): Promise<void>;
}>;

export function createBackendRuntime(config: BackendConfig): BackendRuntime {
  const connection: NodePostgresConnection =
    config.database.mode === "lakebase"
      ? createLakebaseConnection(config.database.lakebase)
      : createNodePostgresDatabase({
          connectionString: config.database.connectionString,
          ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined
        });
  const { db, close } = connection;
  const repository = createPostgresProjectRepository(db);
  const services = createGhostwriterServices({
    projects: repository,
    ids: { create: (kind: DomainIdKind) => `${kind}_${randomUUID()}` },
    clock: { now: () => new Date().toISOString() }
  });

  return { services, close };
}
