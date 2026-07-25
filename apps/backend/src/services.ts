import { randomUUID } from "node:crypto";
import {
  createCanvasServices,
  createBookReaderServices,
  createIdentityServices,
  createGhostwriterServices,
  createCaptureServices,
  createCaptureAttachmentServices,
  createCapturePromotionServices,
  createSceneWritingServices,
  type CaptureAttachmentServices,
  type CaptureObjectStoragePort,
  type CapturePromotionServices,
  type CaptureServices,
  type DomainIdKind,
  type GhostwriterServices,
  type IdentityServices,
  type CanvasServices,
  type BookReaderServices,
  type SceneWritingServices
} from "@ghostwriter/core";
import {
  createLakebaseConnection,
  createNodePostgresDatabase,
  createPostgresCanvasRepository,
  createPostgresCanvasSceneCreationUnitOfWork,
  createPostgresCaptureAttachmentRepository,
  createPostgresCaptureDocumentRepository,
  createPostgresCaptureScenePromotionUnitOfWork,
  createPostgresProjectRepository,
  createPostgresSceneDocumentRepository,
  createPostgresWriterProfileRepository,
  type NodePostgresConnection
} from "@ghostwriter/storage";
import { createBetterAuthGateway, type AuthGateway } from "./auth.js";
import type { BackendConfig } from "./config.js";
import { createAgentProviderRuntime, type AgentProviderRuntime } from "./agent-provider-runtime.js";
import { createCaptureObjectStorageFromConfig } from "./r2-capture-object-storage.js";

export type BackendRuntime = Readonly<{
  services: GhostwriterServices;
  writing: SceneWritingServices;
  captures: CaptureServices;
  captureAttachments: CaptureAttachmentServices;
  capturePromotions: CapturePromotionServices;
  canvas: CanvasServices;
  reader: BookReaderServices;
  identity: IdentityServices;
  agentProvider: AgentProviderRuntime;
  auth: AuthGateway;
  objectStorage: CaptureObjectStoragePort;
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
  const captureDocuments = createPostgresCaptureDocumentRepository(db);
  const captureAttachmentsRepository = createPostgresCaptureAttachmentRepository(db);
  const objectStorage = createCaptureObjectStorageFromConfig(config.r2);
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
  const captures = createCaptureServices({
    projects: repository,
    captureDocuments,
    ids,
    clock
  });
  const captureAttachments = createCaptureAttachmentServices({
    projects: repository,
    captureDocuments,
    attachments: captureAttachmentsRepository,
    objectStorage,
    ids,
    clock
  });
  const capturePromotions = createCapturePromotionServices({
    projects: repository,
    captureDocuments,
    canvases,
    promotion: createPostgresCaptureScenePromotionUnitOfWork(db),
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
  const reader = createBookReaderServices({
    projects: repository,
    sceneDocuments,
    canvases
  });
  const identity = createIdentityServices({ profiles, clock });
  const auth = createBetterAuthGateway(db, config.auth);
  const agentProvider = createAgentProviderRuntime({
    db,
    projects: repository,
    captureDocuments,
    ids,
    clock,
    kekConfig: config.provider.kek,
    callsDisabled: config.provider.callsDisabled,
    capturePromotions,
    sceneDocuments
  });

  return {
    services,
    writing,
    captures,
    captureAttachments,
    capturePromotions,
    canvas,
    reader,
    identity,
    agentProvider,
    auth,
    objectStorage,
    close
  };
}
