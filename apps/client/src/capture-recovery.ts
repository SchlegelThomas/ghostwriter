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

const CAPTURE_RECOVERY_INDEXED_DB: DocumentRecoveryIndexedDbConfig = {
  databaseName: "ghostwriter-capture-recovery",
  databaseVersion: 1,
  recordStoreName: "capture-recoveries",
  keyStoreName: "encryption-keys",
  encryptionKeyId: "capture-recovery-aes-gcm-v1"
};

export const CAPTURE_RECOVERY_RETENTION_MS = DOCUMENT_RECOVERY_RETENTION_MS;
export const MAX_CAPTURE_RECOVERY_PAYLOAD_BYTES =
  MAX_DOCUMENT_RECOVERY_PAYLOAD_BYTES;

export type CaptureRecoveryScope = Readonly<{
  accountId: string;
  projectId: string;
  captureId: string;
}>;

export type CaptureRecoveryEntry = CaptureRecoveryScope &
  Readonly<{
    expectedWorkingVersion: number;
    document: SceneDocumentV1;
    updatedAt: string;
    expiresAt: string;
  }>;

export type CaptureRecoveryStorageMode = "encrypted-browser" | "tab-only";

export type CaptureRecoveryLoadResult = Readonly<{
  mode: CaptureRecoveryStorageMode;
  entry?: CaptureRecoveryEntry;
}>;

export type CaptureRecoveryDecision =
  | "none"
  | "expired"
  | "matches-acknowledged"
  | "offer";

export type EncryptedCaptureRecoveryRecord = CaptureRecoveryScope &
  Readonly<{
    storageVersion: typeof RECOVERY_STORAGE_VERSION;
    recoveryKey: string;
    expectedWorkingVersion: number;
    updatedAt: string;
    expiresAt: string;
    initializationVector: readonly number[];
    ciphertext: ArrayBuffer;
  }>;

export type CaptureRecoveryEncryptedStore =
  DocumentRecoveryEncryptedStore<EncryptedCaptureRecoveryRecord>;

export type CaptureRecoveryService = Readonly<{
  load(scope: CaptureRecoveryScope): Promise<CaptureRecoveryLoadResult>;
  save(
    scope: CaptureRecoveryScope,
    expectedWorkingVersion: number,
    document: SceneDocumentV1
  ): Promise<CaptureRecoveryStorageMode>;
  acknowledge(
    scope: CaptureRecoveryScope,
    document: SceneDocumentV1
  ): Promise<CaptureRecoveryStorageMode>;
  discard(scope: CaptureRecoveryScope): Promise<CaptureRecoveryStorageMode>;
  clearAccount(accountId: string): Promise<CaptureRecoveryStorageMode>;
  getMode(): CaptureRecoveryStorageMode;
}>;

type CaptureRecoveryServiceOptions = Readonly<{
  store?: CaptureRecoveryEncryptedStore;
  crypto?: Crypto;
  now?: () => number;
  tabEntries?: Map<string, CaptureRecoveryEntry>;
}>;

type CaptureRecoveryCoordinatorOptions = Readonly<{
  service: CaptureRecoveryService;
  scope: CaptureRecoveryScope;
  scheduleSave(document: SceneDocumentV1): void;
  onModeChange?(mode: CaptureRecoveryStorageMode): void;
}>;

export type CaptureRecoveryCoordinator = Readonly<{
  capture(
    document: SceneDocumentV1,
    expectedWorkingVersion: number
  ): Promise<void>;
  acknowledge(document: SceneDocumentV1): Promise<void>;
  discard(): Promise<void>;
  flush(): Promise<void>;
}>;

export function captureRecoveryKey(scope: CaptureRecoveryScope): string {
  return JSON.stringify([
    "capture",
    scope.accountId,
    scope.projectId,
    scope.captureId
  ]);
}

export function decideCaptureRecovery(
  entry: CaptureRecoveryEntry | undefined,
  acknowledgedDocument: SceneDocumentV1,
  now = Date.now()
): CaptureRecoveryDecision {
  return decideDocumentRecovery(
    entry,
    acknowledgedDocument,
    serializeCanonicalSceneDocument,
    now
  );
}

function requireRecoveryEntry(value: unknown): CaptureRecoveryEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error("Browser recovery payload is invalid.");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.accountId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.captureId !== "string" ||
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
    captureId: payload.captureId,
    expectedWorkingVersion: payload.expectedWorkingVersion,
    document: validateSceneDocumentV1(payload.document),
    updatedAt: payload.updatedAt,
    expiresAt: payload.expiresAt
  };
}

const captureRecoveryDefinition: DocumentRecoveryDefinition<
  CaptureRecoveryScope,
  CaptureRecoveryEntry,
  SceneDocumentV1,
  EncryptedCaptureRecoveryRecord
> = {
  storageVersion: RECOVERY_STORAGE_VERSION,
  retentionMs: CAPTURE_RECOVERY_RETENTION_MS,
  maxPayloadBytes: MAX_CAPTURE_RECOVERY_PAYLOAD_BYTES,
  payloadTooLargeMessage:
    "The Capture is too large for persistent browser recovery.",
  recoveryKey: captureRecoveryKey,
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
      captureId: entry.captureId,
      expectedWorkingVersion: entry.expectedWorkingVersion,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt
    };
  },
  entryMatchesEncryptedRecord(entry, record) {
    return (
      captureRecoveryKey(entry) === record.recoveryKey &&
      entry.expectedWorkingVersion === record.expectedWorkingVersion &&
      entry.updatedAt === record.updatedAt &&
      entry.expiresAt === record.expiresAt
    );
  },
  recordAccountId(record) {
    return record.accountId;
  }
};

export function createIndexedDbCaptureRecoveryStore(
  indexedDb: IDBFactory
): CaptureRecoveryEncryptedStore {
  return createIndexedDbDocumentRecoveryStore<EncryptedCaptureRecoveryRecord>(
    indexedDb,
    CAPTURE_RECOVERY_INDEXED_DB
  );
}

export function createCaptureRecoveryService(
  options: CaptureRecoveryServiceOptions = {}
): CaptureRecoveryService {
  return createDocumentRecoveryService(captureRecoveryDefinition, options);
}

export function createCaptureRecoveryCoordinator(
  options: CaptureRecoveryCoordinatorOptions
): CaptureRecoveryCoordinator {
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

export const captureRecoveryService = createCaptureRecoveryService({
  ...(browserIndexedDb === undefined
    ? {}
    : { store: createIndexedDbCaptureRecoveryStore(browserIndexedDb) }),
  ...(browserCrypto === undefined ? {} : { crypto: browserCrypto })
});
