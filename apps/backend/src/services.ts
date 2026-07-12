import { randomUUID } from "node:crypto";
import {
  createCanvasServices,
  createIdentityServices,
  createGhostwriterServices,
  createSceneWritingServices,
  type DomainIdKind,
  type GhostwriterServices,
  type IdentityServices,
  type CanvasServices,
  type SceneWritingServices
} from "@ghostwriter/core";
import {
  createLakebaseConnection,
  createNodePostgresDatabase,
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
  createPostgresProjectRepository,
  createPostgresSceneDocumentRepository,
  createPostgresWriterProfileRepository,
  type NodePostgresConnection
} from "@ghostwriter/storage";
import { createBetterAuthGateway, type AuthGateway } from "./auth.js";
import type { BackendConfig } from "./config.js";

export type BackendRuntime = Readonly<{
  services: GhostwriterServices;
  writing: SceneWritingServices;
  canvas: CanvasServices;
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
  const sceneDocuments = createPostgresSceneDocumentRepository(db);
  const canvases = createPostgresCanvasRepository(db);
  const profiles = createPostgresWriterProfileRepository(db);
  const clock = { now: () => new Date().toISOString() };
  const ids = { create: (kind: DomainIdKind) => `${kind}_${randomUUID()}` };
  const services = createGhostwriterServices({
    projects: repository,
    ids,
    clock
  });
  const writing = createSceneWritingServices({
    projects: repository,
    sceneDocuments,
    ids,
    clock
  });
  const canvas = createCanvasServices({
    projects: repository,
    canvases,
    sceneDocuments,
    sceneCreation: createPostgresCanvasSceneCreationUnitOfWork(db),
    ids,
    clock
  });
  const identity = createIdentityServices({ profiles, clock });
  const auth = createBetterAuthGateway(db, config.auth);

  return { services, writing, canvas, identity, auth, close };
}
