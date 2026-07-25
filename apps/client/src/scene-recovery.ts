import {
  serializeCanonicalSceneDocument,
  validateSceneDocumentV1,
  type SceneDocumentV1
} from "@ghostwriter/editor";
import {
  createDocumentRecoveryCoordinator,
  createDocumentRecoveryService,
  createIndexedDbDocumentRecoveryStore,
  decideDocumentRecovery,
  DOCUMENT_RECOVERY_RETENTION_MS,
  MAX_DOCUMENT_RECOVERY_PAYLOAD_BYTES,
  type DocumentRecoveryDefinition,
  type DocumentRecoveryEncryptedStore,
  type DocumentRecoveryIndexedDbConfig
} from "./document-recovery.js";

const RECOVERY_STORAGE_VERSION = 1 as const;

const SCENE_RECOVERY_INDEXED_DB: DocumentRecoveryIndexedDbConfig = {
  databaseName: "ghostwriter-scene-recovery",
  databaseVersion: 1,
  recordStoreName: "scene-recoveries",
  keyStoreName: "encryption-keys",
  encryptionKeyId: "scene-recovery-aes-gcm-v1"
};

export const SCENE_RECOVERY_RETENTION_MS = DOCUMENT_RECOVERY_RETENTION_MS;
export const MAX_SCENE_RECOVERY_PAYLOAD_BYTES =
  MAX_DOCUMENT_RECOVERY_PAYLOAD_BYTES;

export type SceneRecoveryScope = Readonly<{
  accountId: string;
  projectId: string;
  sceneId: string;
}>;

export type SceneRecoveryEntry = SceneRecoveryScope &
  Readonly<{
    expectedWorkingVersion: number;
    document: SceneDocumentV1;
    updatedAt: string;
    expiresAt: string;
  }>;

export type SceneRecoveryStorageMode = "encrypted-browser" | "tab-only";

export type SceneRecoveryLoadResult = Readonly<{
  mode: SceneRecoveryStorageMode;
  entry?: SceneRecoveryEntry;
}>;

export type SceneRecoveryDecision =
  | "none"
  | "expired"
  | "matches-acknowledged"
  | "offer";

export type EncryptedSceneRecoveryRecord = SceneRecoveryScope &
  Readonly<{
    storageVersion: typeof RECOVERY_STORAGE_VERSION;
    recoveryKey: string;
    expectedWorkingVersion: number;
    updatedAt: string;
    expiresAt: string;
    initializationVector: readonly number[];
    ciphertext: ArrayBuffer;
  }>;

export type SceneRecoveryEncryptedStore =
  DocumentRecoveryEncryptedStore<EncryptedSceneRecoveryRecord>;

export type SceneRecoveryService = Readonly<{
  load(scope: SceneRecoveryScope): Promise<SceneRecoveryLoadResult>;
  save(
    scope: SceneRecoveryScope,
    expectedWorkingVersion: number,
    document: SceneDocumentV1
  ): Promise<SceneRecoveryStorageMode>;
  acknowledge(
    scope: SceneRecoveryScope,
    document: SceneDocumentV1
  ): Promise<SceneRecoveryStorageMode>;
  discard(scope: SceneRecoveryScope): Promise<SceneRecoveryStorageMode>;
  clearAccount(accountId: string): Promise<SceneRecoveryStorageMode>;
  getMode(): SceneRecoveryStorageMode;
}>;

type SceneRecoveryServiceOptions = Readonly<{
  store?: SceneRecoveryEncryptedStore;
  crypto?: Crypto;
  now?: () => number;
  tabEntries?: Map<string, SceneRecoveryEntry>;
}>;

type SceneRecoveryCoordinatorOptions = Readonly<{
  service: SceneRecoveryService;
  scope: SceneRecoveryScope;
  scheduleSave(document: SceneDocumentV1): void;
  onModeChange?(mode: SceneRecoveryStorageMode): void;
}>;

export type SceneRecoveryCoordinator = Readonly<{
  capture(
    document: SceneDocumentV1,
    expectedWorkingVersion: number
  ): Promise<void>;
  acknowledge(document: SceneDocumentV1): Promise<void>;
  discard(): Promise<void>;
  flush(): Promise<void>;
}>;

export function sceneRecoveryKey(scope: SceneRecoveryScope): string {
  return JSON.stringify([scope.accountId, scope.projectId, scope.sceneId]);
}

export function decideSceneRecovery(
  entry: SceneRecoveryEntry | undefined,
  acknowledgedDocument: SceneDocumentV1,
  now = Date.now()
): SceneRecoveryDecision {
  return decideDocumentRecovery(
    entry,
    acknowledgedDocument,
    serializeCanonicalSceneDocument,
    now
  );
}

function requireRecoveryEntry(value: unknown): SceneRecoveryEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error("Browser recovery payload is invalid.");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.accountId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.sceneId !== "string" ||
    typeof payload.updatedAt !== "string" ||
    typeof payload.expiresAt !== "string" ||
    typeof payload.expectedWorkingVersion !== "number" ||
    !Number.isSafeInteger(payload.expectedWorkingVersion) ||
    payload.expectedWorkingVersion < 1
  ) {
    throw new Error("Browser recovery metadata is invalid.");
  }
  return {
    accountId: payload.accountId,
    projectId: payload.projectId,
    sceneId: payload.sceneId,
    expectedWorkingVersion: payload.expectedWorkingVersion,
    document: validateSceneDocumentV1(payload.document),
    updatedAt: payload.updatedAt,
    expiresAt: payload.expiresAt
  };
}

const sceneRecoveryDefinition: DocumentRecoveryDefinition<
  SceneRecoveryScope,
  SceneRecoveryEntry,
  SceneDocumentV1,
  EncryptedSceneRecoveryRecord
> = {
  storageVersion: RECOVERY_STORAGE_VERSION,
  retentionMs: SCENE_RECOVERY_RETENTION_MS,
  maxPayloadBytes: MAX_SCENE_RECOVERY_PAYLOAD_BYTES,
  payloadTooLargeMessage:
    "The Draft is too large for persistent browser recovery.",
  recoveryKey: sceneRecoveryKey,
  validateDocument: validateSceneDocumentV1,
  serializeDocument: serializeCanonicalSceneDocument,
  buildEntry(scope, expectedWorkingVersion, document, updatedAt, expiresAt) {
    return {
      ...scope,
      expectedWorkingVersion,
      document,
      updatedAt,
      expiresAt
    };
  },
  parseEntryPayload: requireRecoveryEntry,
  encryptedMetadata(entry, recoveryKey) {
    return {
      storageVersion: RECOVERY_STORAGE_VERSION,
      recoveryKey,
      accountId: entry.accountId,
      projectId: entry.projectId,
      sceneId: entry.sceneId,
      expectedWorkingVersion: entry.expectedWorkingVersion,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt
    };
  },
  entryMatchesEncryptedRecord(entry, record) {
    return (
      sceneRecoveryKey(entry) === record.recoveryKey &&
      entry.expectedWorkingVersion === record.expectedWorkingVersion &&
      entry.updatedAt === record.updatedAt &&
      entry.expiresAt === record.expiresAt
    );
  },
  recordAccountId(record) {
    return record.accountId;
  }
};

export function createIndexedDbSceneRecoveryStore(
  indexedDb: IDBFactory
): SceneRecoveryEncryptedStore {
  return createIndexedDbDocumentRecoveryStore<EncryptedSceneRecoveryRecord>(
    indexedDb,
    SCENE_RECOVERY_INDEXED_DB
  );
}

export function createSceneRecoveryService(
  options: SceneRecoveryServiceOptions = {}
): SceneRecoveryService {
  return createDocumentRecoveryService(sceneRecoveryDefinition, options);
}

export function createSceneRecoveryCoordinator(
  options: SceneRecoveryCoordinatorOptions
): SceneRecoveryCoordinator {
  return createDocumentRecoveryCoordinator(options);
}

const browserIndexedDb =
  typeof globalThis.indexedDB === "undefined"
    ? undefined
    : globalThis.indexedDB;
const browserCrypto =
  typeof globalThis.crypto === "undefined" ||
  globalThis.crypto.subtle === undefined
    ? undefined
    : globalThis.crypto;

export const sceneRecoveryService = createSceneRecoveryService({
  ...(browserIndexedDb === undefined
    ? {}
    : { store: createIndexedDbSceneRecoveryStore(browserIndexedDb) }),
  ...(browserCrypto === undefined ? {} : { crypto: browserCrypto })
});
