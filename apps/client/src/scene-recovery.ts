import {
  serializeCanonicalSceneDocument,
  validateSceneDocumentV1,
  type SceneDocumentV1
} from "@ghostwriter/editor";

const RECOVERY_DATABASE_NAME = "ghostwriter-scene-recovery";
const RECOVERY_DATABASE_VERSION = 1;
const RECOVERY_RECORD_STORE = "scene-recoveries";
const RECOVERY_KEY_STORE = "encryption-keys";
const RECOVERY_KEY_ID = "scene-recovery-aes-gcm-v1";
const RECOVERY_STORAGE_VERSION = 1 as const;
const AES_GCM_IV_BYTES = 12;

export const SCENE_RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_SCENE_RECOVERY_PAYLOAD_BYTES = 2 * 1_024 * 1_024;

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

export type SceneRecoveryEncryptedStore = Readonly<{
  getRecord(recoveryKey: string): Promise<EncryptedSceneRecoveryRecord | undefined>;
  putRecord(record: EncryptedSceneRecoveryRecord): Promise<void>;
  deleteRecord(recoveryKey: string): Promise<void>;
  listRecords(): Promise<readonly EncryptedSceneRecoveryRecord[]>;
  getOrCreateEncryptionKey(
    createKey: () => Promise<CryptoKey>
  ): Promise<CryptoKey>;
}>;

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
  if (entry === undefined) return "none";
  const expiresAt = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
  return serializeCanonicalSceneDocument(entry.document) ===
    serializeCanonicalSceneDocument(acknowledgedDocument)
    ? "matches-acknowledged"
    : "offer";
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Browser recovery transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Browser recovery transaction was aborted."));
  });
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser recovery request failed."));
  });
}

function openRecoveryDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      RECOVERY_DATABASE_NAME,
      RECOVERY_DATABASE_VERSION
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECOVERY_RECORD_STORE)) {
        database.createObjectStore(RECOVERY_RECORD_STORE, {
          keyPath: "recoveryKey"
        });
      }
      if (!database.objectStoreNames.contains(RECOVERY_KEY_STORE)) {
        database.createObjectStore(RECOVERY_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser recovery could not open."));
    request.onblocked = () =>
      reject(new Error("Browser recovery is blocked by another page."));
  });
}

export function createIndexedDbSceneRecoveryStore(
  indexedDb: IDBFactory
): SceneRecoveryEncryptedStore {
  return {
    async getRecord(recoveryKey) {
      const database = await openRecoveryDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          RECOVERY_RECORD_STORE,
          "readonly"
        );
        const completed = transactionCompletion(transaction);
        const record = await requestResult(
          transaction
            .objectStore(RECOVERY_RECORD_STORE)
            .get(recoveryKey) as IDBRequest<
            EncryptedSceneRecoveryRecord | undefined
          >
        );
        await completed;
        return record;
      } finally {
        database.close();
      }
    },

    async putRecord(record) {
      const database = await openRecoveryDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          RECOVERY_RECORD_STORE,
          "readwrite"
        );
        const completed = transactionCompletion(transaction);
        await requestResult(
          transaction.objectStore(RECOVERY_RECORD_STORE).put(record)
        );
        await completed;
      } finally {
        database.close();
      }
    },

    async deleteRecord(recoveryKey) {
      const database = await openRecoveryDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          RECOVERY_RECORD_STORE,
          "readwrite"
        );
        const completed = transactionCompletion(transaction);
        await requestResult(
          transaction.objectStore(RECOVERY_RECORD_STORE).delete(recoveryKey)
        );
        await completed;
      } finally {
        database.close();
      }
    },

    async listRecords() {
      const database = await openRecoveryDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          RECOVERY_RECORD_STORE,
          "readonly"
        );
        const completed = transactionCompletion(transaction);
        const records = await requestResult(
          transaction.objectStore(RECOVERY_RECORD_STORE).getAll() as IDBRequest<
            EncryptedSceneRecoveryRecord[]
          >
        );
        await completed;
        return records;
      } finally {
        database.close();
      }
    },

    async getOrCreateEncryptionKey(createKey) {
      const database = await openRecoveryDatabase(indexedDb);
      try {
        const readTransaction = database.transaction(
          RECOVERY_KEY_STORE,
          "readonly"
        );
        const readCompleted = transactionCompletion(readTransaction);
        const existing = await requestResult(
          readTransaction
            .objectStore(RECOVERY_KEY_STORE)
            .get(RECOVERY_KEY_ID) as IDBRequest<CryptoKey | undefined>
        );
        await readCompleted;
        if (existing !== undefined) return existing;

        const candidate = await createKey();
        const writeTransaction = database.transaction(
          RECOVERY_KEY_STORE,
          "readwrite"
        );
        const writeCompleted = transactionCompletion(writeTransaction);
        const keyStore = writeTransaction.objectStore(RECOVERY_KEY_STORE);
        const selected = await new Promise<CryptoKey>((resolve, reject) => {
          const getRequest = keyStore.get(RECOVERY_KEY_ID) as IDBRequest<
            CryptoKey | undefined
          >;
          getRequest.onerror = () =>
            reject(
              getRequest.error ??
                new Error("Browser recovery could not read its encryption key.")
            );
          getRequest.onsuccess = () => {
            if (getRequest.result !== undefined) {
              resolve(getRequest.result);
              return;
            }
            const putRequest = keyStore.put(candidate, RECOVERY_KEY_ID);
            putRequest.onerror = () =>
              reject(
                putRequest.error ??
                  new Error("Browser recovery could not store its encryption key.")
              );
            putRequest.onsuccess = () => resolve(candidate);
          };
        });
        await writeCompleted;
        return selected;
      } finally {
        database.close();
      }
    }
  };
}

function additionalData(
  record: Omit<
    EncryptedSceneRecoveryRecord,
    "initializationVector" | "ciphertext"
  >
): ArrayBuffer {
  return copiedArrayBuffer(
    new TextEncoder().encode(
      JSON.stringify({
        storageVersion: record.storageVersion,
        recoveryKey: record.recoveryKey,
        accountId: record.accountId,
        projectId: record.projectId,
        sceneId: record.sceneId,
        expectedWorkingVersion: record.expectedWorkingVersion,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt
      })
    )
  );
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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

async function createEncryptionKey(cryptoApi: Crypto): Promise<CryptoKey> {
  // The non-exportable key and ciphertext live in the same origin-private
  // IndexedDB. This limits casual at-rest disclosure only. It cannot protect
  // against same-origin script compromise: script running as Ghostwriter can
  // ask WebCrypto to use the key even though it cannot export the key bytes.
  return cryptoApi.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptRecovery(
  store: SceneRecoveryEncryptedStore,
  cryptoApi: Crypto,
  entry: SceneRecoveryEntry
): Promise<EncryptedSceneRecoveryRecord> {
  const recoveryKey = sceneRecoveryKey(entry);
  const metadata = {
    storageVersion: RECOVERY_STORAGE_VERSION,
    recoveryKey,
    accountId: entry.accountId,
    projectId: entry.projectId,
    sceneId: entry.sceneId,
    expectedWorkingVersion: entry.expectedWorkingVersion,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt
  } as const;
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(entry));
  const plaintext = copiedArrayBuffer(plaintextBytes);
  if (plaintext.byteLength > MAX_SCENE_RECOVERY_PAYLOAD_BYTES) {
    throw new Error("The Draft is too large for persistent browser recovery.");
  }
  const initializationVector = cryptoApi.getRandomValues(
    new Uint8Array(AES_GCM_IV_BYTES)
  );
  const key = await store.getOrCreateEncryptionKey(() =>
    createEncryptionKey(cryptoApi)
  );
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: initializationVector,
      additionalData: additionalData(metadata)
    },
    key,
    plaintext
  );
  return {
    ...metadata,
    initializationVector: Array.from(initializationVector),
    ciphertext
  };
}

async function decryptRecovery(
  store: SceneRecoveryEncryptedStore,
  cryptoApi: Crypto,
  record: EncryptedSceneRecoveryRecord
): Promise<SceneRecoveryEntry> {
  if (record.storageVersion !== RECOVERY_STORAGE_VERSION) {
    throw new Error("Browser recovery uses an unsupported format.");
  }
  const key = await store.getOrCreateEncryptionKey(() =>
    createEncryptionKey(cryptoApi)
  );
  const plaintext = await cryptoApi.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(record.initializationVector),
      additionalData: additionalData(record)
    },
    key,
    record.ciphertext
  );
  const entry = requireRecoveryEntry(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  );
  if (
    sceneRecoveryKey(entry) !== record.recoveryKey ||
    entry.expectedWorkingVersion !== record.expectedWorkingVersion ||
    entry.updatedAt !== record.updatedAt ||
    entry.expiresAt !== record.expiresAt
  ) {
    throw new Error("Browser recovery metadata does not match its ciphertext.");
  }
  return entry;
}

function validEntry(
  entry: SceneRecoveryEntry | undefined,
  now: number
): SceneRecoveryEntry | undefined {
  if (entry === undefined) return undefined;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now ? entry : undefined;
}

export function createSceneRecoveryService(
  options: SceneRecoveryServiceOptions = {}
): SceneRecoveryService {
  const now = options.now ?? Date.now;
  const tabEntries = options.tabEntries ?? new Map<string, SceneRecoveryEntry>();
  let persistentStore =
    options.store !== undefined && options.crypto !== undefined
      ? options.store
      : undefined;
  const cryptoApi = options.crypto;

  function mode(): SceneRecoveryStorageMode {
    return persistentStore === undefined ? "tab-only" : "encrypted-browser";
  }

  function tabLoad(scope: SceneRecoveryScope): SceneRecoveryEntry | undefined {
    const key = sceneRecoveryKey(scope);
    const entry = validEntry(tabEntries.get(key), now());
    if (entry === undefined) tabEntries.delete(key);
    return entry;
  }

  const service: SceneRecoveryService = {
    async load(scope) {
      const key = sceneRecoveryKey(scope);
      if (persistentStore !== undefined && cryptoApi !== undefined) {
        try {
          const record = await persistentStore.getRecord(key);
          if (record === undefined) {
            return { mode: "encrypted-browser" };
          }
          const entry = await decryptRecovery(
            persistentStore,
            cryptoApi,
            record
          );
          if (validEntry(entry, now()) === undefined) {
            await persistentStore.deleteRecord(key);
            return { mode: "encrypted-browser" };
          }
          return { mode: "encrypted-browser", entry };
        } catch {
          persistentStore = undefined;
        }
      }
      const entry = tabLoad(scope);
      return {
        mode: "tab-only",
        ...(entry === undefined ? {} : { entry })
      };
    },

    async save(scope, expectedWorkingVersion, document) {
      if (
        !Number.isSafeInteger(expectedWorkingVersion) ||
        expectedWorkingVersion < 1
      ) {
        throw new Error("Recovery requires a positive working version.");
      }
      const updatedAtMilliseconds = now();
      const entry: SceneRecoveryEntry = {
        ...scope,
        expectedWorkingVersion,
        document: validateSceneDocumentV1(document),
        updatedAt: new Date(updatedAtMilliseconds).toISOString(),
        expiresAt: new Date(
          updatedAtMilliseconds + SCENE_RECOVERY_RETENTION_MS
        ).toISOString()
      };
      const key = sceneRecoveryKey(scope);
      if (persistentStore !== undefined && cryptoApi !== undefined) {
        try {
          await persistentStore.putRecord(
            await encryptRecovery(persistentStore, cryptoApi, entry)
          );
          tabEntries.delete(key);
          return "encrypted-browser";
        } catch {
          persistentStore = undefined;
        }
      }
      tabEntries.set(key, entry);
      return "tab-only";
    },

    async acknowledge(scope, document) {
      const loaded = await service.load(scope);
      if (
        loaded.entry !== undefined &&
        serializeCanonicalSceneDocument(loaded.entry.document) ===
          serializeCanonicalSceneDocument(document)
      ) {
        return service.discard(scope);
      }
      return loaded.mode;
    },

    async discard(scope) {
      const key = sceneRecoveryKey(scope);
      tabEntries.delete(key);
      if (persistentStore !== undefined) {
        try {
          await persistentStore.deleteRecord(key);
          return "encrypted-browser";
        } catch {
          persistentStore = undefined;
        }
      }
      return "tab-only";
    },

    async clearAccount(accountId) {
      for (const [key, entry] of tabEntries) {
        if (entry.accountId === accountId) tabEntries.delete(key);
      }
      if (persistentStore !== undefined) {
        try {
          const records = await persistentStore.listRecords();
          await Promise.all(
            records
              .filter((record) => record.accountId === accountId)
              .map((record) =>
                persistentStore?.deleteRecord(record.recoveryKey)
              )
          );
          return "encrypted-browser";
        } catch {
          persistentStore = undefined;
        }
      }
      return "tab-only";
    },

    getMode: mode
  };

  return service;
}

export function createSceneRecoveryCoordinator(
  options: SceneRecoveryCoordinatorOptions
): SceneRecoveryCoordinator {
  let tasks: Promise<void> = Promise.resolve();

  function append(task: () => Promise<void>): Promise<void> {
    const result = tasks.catch(() => undefined).then(task);
    tasks = result.catch(() => undefined);
    return result;
  }

  return {
    capture(document, expectedWorkingVersion) {
      return append(async () => {
        try {
          const mode = await options.service.save(
            options.scope,
            expectedWorkingVersion,
            document
          );
          options.onModeChange?.(mode);
        } finally {
          options.scheduleSave(document);
        }
      });
    },

    acknowledge(document) {
      return append(async () => {
        options.onModeChange?.(
          await options.service.acknowledge(options.scope, document)
        );
      });
    },

    discard() {
      return append(async () => {
        options.onModeChange?.(await options.service.discard(options.scope));
      });
    },

    async flush() {
      let observed = tasks;
      await observed;
      while (observed !== tasks) {
        observed = tasks;
        await observed;
      }
    }
  };
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
