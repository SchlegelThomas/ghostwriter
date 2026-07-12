import { randomUUID } from "node:crypto";
import {
  createIdentityServices,
  createGhostwriterServices,
  type DomainIdKind,
  type GhostwriterServices,
  type IdentityServices
} from "@ghostwriter/core";
import {
  createLakebaseConnection,
  createNodePostgresDatabase,
  createPostgresProjectRepository,
  createPostgresWriterProfileRepository,
  type NodePostgresConnection
} from "@ghostwriter/storage";
import { createBetterAuthGateway, type AuthGateway } from "./auth.js";
import type { BackendConfig } from "./config.js";

export type BackendRuntime = Readonly<{
  services: GhostwriterServices;
  identity: IdentityServices;
  auth: AuthGateway;
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
  const profiles = createPostgresWriterProfileRepository(db);
  const clock = { now: () => new Date().toISOString() };
  const services = createGhostwriterServices({
    projects: repository,
    ids: { create: (kind: DomainIdKind) => `${kind}_${randomUUID()}` },
    clock
  });
  const identity = createIdentityServices({ profiles, clock });
  const auth = createBetterAuthGateway(db, config.auth);

  return { services, identity, auth, close };
}
