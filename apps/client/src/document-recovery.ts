export const DOCUMENT_RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_DOCUMENT_RECOVERY_PAYLOAD_BYTES = 2 * 1_024 * 1_024;

const AES_GCM_IV_BYTES = 12;

export type DocumentRecoveryStorageMode = "encrypted-browser" | "tab-only";

export type DocumentRecoveryDecision =
  | "none"
  | "expired"
  | "matches-acknowledged"
  | "offer";

export type DocumentRecoveryEncryptedStore<EncryptedRecord> = Readonly<{
  getRecord(recoveryKey: string): Promise<EncryptedRecord | undefined>;
  putRecord(record: EncryptedRecord): Promise<void>;
  deleteRecord(recoveryKey: string): Promise<void>;
  listRecords(): Promise<readonly EncryptedRecord[]>;
  getOrCreateEncryptionKey(
    createKey: () => Promise<CryptoKey>
  ): Promise<CryptoKey>;
}>;

export type DocumentRecoveryLoadResult<Entry> = Readonly<{
  mode: DocumentRecoveryStorageMode;
  entry?: Entry;
}>;

export type DocumentRecoveryService<Scope, Entry, Document> = Readonly<{
  load(scope: Scope): Promise<DocumentRecoveryLoadResult<Entry>>;
  save(
    scope: Scope,
    expectedWorkingVersion: number,
    document: Document
  ): Promise<DocumentRecoveryStorageMode>;
  acknowledge(
    scope: Scope,
    document: Document
  ): Promise<DocumentRecoveryStorageMode>;
  discard(scope: Scope): Promise<DocumentRecoveryStorageMode>;
  clearAccount(accountId: string): Promise<DocumentRecoveryStorageMode>;
  getMode(): DocumentRecoveryStorageMode;
}>;

export type DocumentRecoveryCoordinator<Document> = Readonly<{
  capture(document: Document, expectedWorkingVersion: number): Promise<void>;
  acknowledge(document: Document): Promise<void>;
  discard(): Promise<void>;
  flush(): Promise<void>;
}>;

export type DocumentRecoveryIndexedDbConfig = Readonly<{
  databaseName: string;
  databaseVersion: number;
  recordStoreName: string;
  keyStoreName: string;
  encryptionKeyId: string;
}>;

export type DocumentRecoveryDefinition<
  Scope extends Readonly<{ accountId: string; projectId: string }>,
  Entry extends Scope &
    Readonly<{
      expectedWorkingVersion: number;
      document: Document;
      updatedAt: string;
      expiresAt: string;
    }>,
  Document,
  EncryptedRecord extends Scope &
    Readonly<{
      storageVersion: number;
      recoveryKey: string;
      expectedWorkingVersion: number;
      updatedAt: string;
      expiresAt: string;
      initializationVector: readonly number[];
      ciphertext: ArrayBuffer;
    }>
> = Readonly<{
  storageVersion: number;
  retentionMs: number;
  maxPayloadBytes: number;
  payloadTooLargeMessage: string;
  recoveryKey(scope: Scope): string;
  validateDocument(document: Document): Document;
  serializeDocument(document: Document): string;
  buildEntry(
    scope: Scope,
    expectedWorkingVersion: number,
    document: Document,
    updatedAt: string,
    expiresAt: string
  ): Entry;
  parseEntryPayload(value: unknown): Entry;
  encryptedMetadata(
    entry: Entry,
    recoveryKey: string
  ): Omit<EncryptedRecord, "initializationVector" | "ciphertext">;
  entryMatchesEncryptedRecord(entry: Entry, record: EncryptedRecord): boolean;
  recordAccountId(record: EncryptedRecord): string;
}>;

type DocumentRecoveryServiceOptions<Entry> = Readonly<{
  store?: DocumentRecoveryEncryptedStore<unknown>;
  crypto?: Crypto;
  now?: () => number;
  tabEntries?: Map<string, Entry>;
}>;

type DocumentRecoveryCoordinatorOptions<Scope, Document> = Readonly<{
  service: DocumentRecoveryService<Scope, unknown, Document>;
  scope: Scope;
  scheduleSave(document: Document): void;
  onModeChange?(mode: DocumentRecoveryStorageMode): void;
}>;

export function decideDocumentRecovery<Document>(
  entry: { document: Document; expiresAt: string } | undefined,
  acknowledgedDocument: Document,
  serializeDocument: (document: Document) => string,
  now = Date.now()
): DocumentRecoveryDecision {
  if (entry === undefined) return "none";
  const expiresAt = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
  return serializeDocument(entry.document) === serializeDocument(acknowledgedDocument)
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

function openRecoveryDatabase(
  indexedDb: IDBFactory,
  config: DocumentRecoveryIndexedDbConfig
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      config.databaseName,
      config.databaseVersion
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(config.recordStoreName)) {
        database.createObjectStore(config.recordStoreName, {
          keyPath: "recoveryKey"
        });
      }
      if (!database.objectStoreNames.contains(config.keyStoreName)) {
        database.createObjectStore(config.keyStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser recovery could not open."));
    request.onblocked = () =>
      reject(new Error("Browser recovery is blocked by another page."));
  });
}

export function createIndexedDbDocumentRecoveryStore<EncryptedRecord>(
  indexedDb: IDBFactory,
  config: DocumentRecoveryIndexedDbConfig
): DocumentRecoveryEncryptedStore<EncryptedRecord> {
  return {
    async getRecord(recoveryKey) {
      const database = await openRecoveryDatabase(indexedDb, config);
      try {
        const transaction = database.transaction(
          config.recordStoreName,
          "readonly"
        );
        const completed = transactionCompletion(transaction);
        const record = await requestResult(
          transaction
            .objectStore(config.recordStoreName)
            .get(recoveryKey) as IDBRequest<EncryptedRecord | undefined>
        );
        await completed;
        return record;
      } finally {
        database.close();
      }
    },

    async putRecord(record) {
      const database = await openRecoveryDatabase(indexedDb, config);
      try {
        const transaction = database.transaction(
          config.recordStoreName,
          "readwrite"
        );
        const completed = transactionCompletion(transaction);
        await requestResult(
          transaction.objectStore(config.recordStoreName).put(record)
        );
        await completed;
      } finally {
        database.close();
      }
    },

    async deleteRecord(recoveryKey) {
      const database = await openRecoveryDatabase(indexedDb, config);
      try {
        const transaction = database.transaction(
          config.recordStoreName,
          "readwrite"
        );
        const completed = transactionCompletion(transaction);
        await requestResult(
          transaction
            .objectStore(config.recordStoreName)
            .delete(recoveryKey)
        );
        await completed;
      } finally {
        database.close();
      }
    },

    async listRecords() {
      const database = await openRecoveryDatabase(indexedDb, config);
      try {
        const transaction = database.transaction(
          config.recordStoreName,
          "readonly"
        );
        const completed = transactionCompletion(transaction);
        const records = await requestResult(
          transaction
            .objectStore(config.recordStoreName)
            .getAll() as IDBRequest<EncryptedRecord[]>
        );
        await completed;
        return records;
      } finally {
        database.close();
      }
    },

    async getOrCreateEncryptionKey(createKey) {
      const database = await openRecoveryDatabase(indexedDb, config);
      try {
        const readTransaction = database.transaction(
          config.keyStoreName,
          "readonly"
        );
        const readCompleted = transactionCompletion(readTransaction);
        const existing = await requestResult(
          readTransaction
            .objectStore(config.keyStoreName)
            .get(config.encryptionKeyId) as IDBRequest<CryptoKey | undefined>
        );
        await readCompleted;
        if (existing !== undefined) return existing;

        const candidate = await createKey();
        const writeTransaction = database.transaction(
          config.keyStoreName,
          "readwrite"
        );
        const writeCompleted = transactionCompletion(writeTransaction);
        const keyStore = writeTransaction.objectStore(config.keyStoreName);
        const selected = await new Promise<CryptoKey>((resolve, reject) => {
          const getRequest = keyStore.get(config.encryptionKeyId) as IDBRequest<
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
            const putRequest = keyStore.put(candidate, config.encryptionKeyId);
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

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function additionalData(metadata: Record<string, unknown>): ArrayBuffer {
  return copiedArrayBuffer(new TextEncoder().encode(JSON.stringify(metadata)));
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

function validEntry<Entry extends { expiresAt: string }>(
  entry: Entry | undefined,
  now: number
): Entry | undefined {
  if (entry === undefined) return undefined;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now ? entry : undefined;
}

export function createDocumentRecoveryService<
  Scope extends Readonly<{ accountId: string; projectId: string }>,
  Entry extends Scope &
    Readonly<{
      expectedWorkingVersion: number;
      document: Document;
      updatedAt: string;
      expiresAt: string;
    }>,
  Document,
  EncryptedRecord extends Scope &
    Readonly<{
      storageVersion: number;
      recoveryKey: string;
      expectedWorkingVersion: number;
      updatedAt: string;
      expiresAt: string;
      initializationVector: readonly number[];
      ciphertext: ArrayBuffer;
    }>
>(
  definition: DocumentRecoveryDefinition<
    Scope,
    Entry,
    Document,
    EncryptedRecord
  >,
  options: DocumentRecoveryServiceOptions<Entry> = {}
): DocumentRecoveryService<Scope, Entry, Document> {
  const now = options.now ?? Date.now;
  const tabEntries = options.tabEntries ?? new Map<string, Entry>();
  let persistentStore =
    options.store !== undefined && options.crypto !== undefined
      ? (options.store as DocumentRecoveryEncryptedStore<EncryptedRecord>)
      : undefined;
  const cryptoApi = options.crypto;

  function mode(): DocumentRecoveryStorageMode {
    return persistentStore === undefined ? "tab-only" : "encrypted-browser";
  }

  function tabLoad(scope: Scope): Entry | undefined {
    const key = definition.recoveryKey(scope);
    const entry = validEntry(tabEntries.get(key), now());
    if (entry === undefined) tabEntries.delete(key);
    return entry;
  }

  async function encryptRecovery(entry: Entry): Promise<EncryptedRecord> {
    if (persistentStore === undefined || cryptoApi === undefined) {
      throw new Error("Browser recovery is not configured for encryption.");
    }
    const recoveryKey = definition.recoveryKey(entry);
    const metadata = definition.encryptedMetadata(entry, recoveryKey);
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(entry));
    const plaintext = copiedArrayBuffer(plaintextBytes);
    if (plaintext.byteLength > definition.maxPayloadBytes) {
      throw new Error(definition.payloadTooLargeMessage);
    }
    const initializationVector = cryptoApi.getRandomValues(
      new Uint8Array(AES_GCM_IV_BYTES)
    );
    const key = await persistentStore.getOrCreateEncryptionKey(() =>
      createEncryptionKey(cryptoApi)
    );
    const ciphertext = await cryptoApi.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: initializationVector,
        additionalData: additionalData(metadata as Record<string, unknown>)
      },
      key,
      plaintext
    );
    return {
      ...metadata,
      initializationVector: Array.from(initializationVector),
      ciphertext
    } as unknown as EncryptedRecord;
  }

  async function decryptRecovery(record: EncryptedRecord): Promise<Entry> {
    if (persistentStore === undefined || cryptoApi === undefined) {
      throw new Error("Browser recovery is not configured for encryption.");
    }
    if (record.storageVersion !== definition.storageVersion) {
      throw new Error("Browser recovery uses an unsupported format.");
    }
    const key = await persistentStore.getOrCreateEncryptionKey(() =>
      createEncryptionKey(cryptoApi)
    );
    const { initializationVector, ciphertext, ...authenticatedMetadata } =
      record;
    void initializationVector;
    void ciphertext;
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(record.initializationVector),
        additionalData: additionalData(
          authenticatedMetadata as Record<string, unknown>
        )
      },
      key,
      record.ciphertext
    );
    const entry = definition.parseEntryPayload(
      JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    );
    if (!definition.entryMatchesEncryptedRecord(entry, record)) {
      throw new Error("Browser recovery metadata does not match its ciphertext.");
    }
    return entry;
  }

  const service: DocumentRecoveryService<Scope, Entry, Document> = {
    async load(scope) {
      const key = definition.recoveryKey(scope);
      if (persistentStore !== undefined && cryptoApi !== undefined) {
        try {
          const record = await persistentStore.getRecord(key);
          if (record === undefined) {
            return { mode: "encrypted-browser" };
          }
          const entry = await decryptRecovery(record);
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
      const entry = definition.buildEntry(
        scope,
        expectedWorkingVersion,
        definition.validateDocument(document),
        new Date(updatedAtMilliseconds).toISOString(),
        new Date(updatedAtMilliseconds + definition.retentionMs).toISOString()
      );
      const key = definition.recoveryKey(scope);
      if (persistentStore !== undefined && cryptoApi !== undefined) {
        try {
          await persistentStore.putRecord(await encryptRecovery(entry));
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
        definition.serializeDocument(loaded.entry.document) ===
          definition.serializeDocument(document)
      ) {
        return service.discard(scope);
      }
      return loaded.mode;
    },

    async discard(scope) {
      const key = definition.recoveryKey(scope);
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
              .filter((record) => definition.recordAccountId(record) === accountId)
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

export function createDocumentRecoveryCoordinator<Scope, Document>(
  options: DocumentRecoveryCoordinatorOptions<Scope, Document>
): DocumentRecoveryCoordinator<Document> {
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
