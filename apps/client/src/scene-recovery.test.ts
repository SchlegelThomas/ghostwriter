import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it, vi } from "vitest";
import {
  createSceneRecoveryCoordinator,
  createSceneRecoveryService,
  decideSceneRecovery,
  SCENE_RECOVERY_RETENTION_MS,
  sceneRecoveryKey,
  type EncryptedSceneRecoveryRecord,
  type SceneRecoveryEncryptedStore,
  type SceneRecoveryService
} from "./scene-recovery.js";

const scope = {
  accountId: "account-writer",
  projectId: "project-harbor",
  sceneId: "scene-opening"
} as const;

function sceneDocument(text: string): SceneDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId("block-recovery") },
          content: [{ type: "text", text }]
        }
      ]
    }
  };
}

function memoryEncryptedStore(): SceneRecoveryEncryptedStore & {
  readonly records: Map<string, EncryptedSceneRecoveryRecord>;
  encryptionKey(): CryptoKey | undefined;
} {
  const records = new Map<string, EncryptedSceneRecoveryRecord>();
  let key: CryptoKey | undefined;
  return {
    records,
    encryptionKey: () => key,
    async getRecord(recoveryKey) {
      return records.get(recoveryKey);
    },
    async putRecord(record) {
      records.set(record.recoveryKey, record);
    },
    async deleteRecord(recoveryKey) {
      records.delete(recoveryKey);
    },
    async listRecords() {
      return [...records.values()];
    },
    async getOrCreateEncryptionKey(createKey) {
      key ??= await createKey();
      return key;
    }
  };
}

function webCrypto(): Crypto {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("The test runtime does not provide WebCrypto.");
  }
  return globalThis.crypto;
}

describe("scene recovery", () => {
  it("encrypts and decrypts one latest recovery with a non-exportable key", async () => {
    const store = memoryEncryptedStore();
    const local = sceneDocument("The harbor remembers.");
    const service = createSceneRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });

    await expect(service.save(scope, 4, local)).resolves.toBe(
      "encrypted-browser"
    );
    const encrypted = store.records.get(sceneRecoveryKey(scope));
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toHaveProperty("document");
    expect(encrypted?.ciphertext.byteLength).toBeGreaterThan(0);
    expect(store.encryptionKey()?.extractable).toBe(false);
    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser",
      entry: {
        ...scope,
        expectedWorkingVersion: 4,
        document: local,
        updatedAt: "2026-07-12T18:00:00.000Z",
        expiresAt: "2026-07-19T18:00:00.000Z"
      }
    });
  });

  it("persists recovery before handing a change to the network save queue", async () => {
    let finishPersistence!: () => void;
    const persisted = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const scheduleSave = vi.fn();
    const service: SceneRecoveryService = {
      load: vi.fn(),
      save: vi.fn(async () => {
        await persisted;
        return "encrypted-browser" as const;
      }),
      acknowledge: vi.fn(),
      discard: vi.fn(),
      clearAccount: vi.fn(),
      getMode: () => "encrypted-browser"
    };
    const coordinator = createSceneRecoveryCoordinator({
      service,
      scope,
      scheduleSave
    });
    const local = sceneDocument("Unacknowledged words.");

    const capture = coordinator.capture(local, 2);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.save).toHaveBeenCalledWith(scope, 2, local);
    expect(scheduleSave).not.toHaveBeenCalled();
    finishPersistence();
    await capture;
    expect(scheduleSave).toHaveBeenCalledWith(local);
  });

  it("retains a newer local recovery and clears it after a matching acknowledgement", async () => {
    const store = memoryEncryptedStore();
    const service = createSceneRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });
    const acknowledged = sceneDocument("Acknowledged.");
    const local = sceneDocument("Acknowledged, then changed locally.");
    await service.save(scope, 2, local);

    await service.acknowledge(scope, acknowledged);
    await expect(service.load(scope)).resolves.toMatchObject({
      entry: { document: local }
    });

    await service.acknowledge(scope, local);
    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser"
    });
  });

  it("expires recovery after seven days", async () => {
    let now = Date.parse("2026-07-12T18:00:00.000Z");
    const store = memoryEncryptedStore();
    const service = createSceneRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => now
    });
    await service.save(scope, 1, sceneDocument("Temporary words."));

    now += SCENE_RECOVERY_RETENTION_MS;
    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser"
    });
    expect(store.records).toHaveLength(0);
  });

  it("clears only the signed-out account's recoveries", async () => {
    const store = memoryEncryptedStore();
    const service = createSceneRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });
    const otherScope = { ...scope, accountId: "account-other" };
    await service.save(scope, 1, sceneDocument("Writer recovery."));
    await service.save(otherScope, 1, sceneDocument("Other recovery."));

    await service.clearAccount(scope.accountId);

    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser"
    });
    await expect(service.load(otherScope)).resolves.toMatchObject({
      entry: { accountId: "account-other" }
    });
  });

  it("offers only a nonexpired recovery that differs from the server Draft", () => {
    const server = sceneDocument("Server Draft.");
    const local = sceneDocument("Local Draft.");
    const entry = {
      ...scope,
      expectedWorkingVersion: 2,
      document: local,
      updatedAt: "2026-07-12T18:00:00.000Z",
      expiresAt: "2026-07-19T18:00:00.000Z"
    } as const;

    expect(
      decideSceneRecovery(
        entry,
        server,
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toBe("offer");
    expect(
      decideSceneRecovery(
        { ...entry, document: server },
        server,
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toBe("matches-acknowledged");
    expect(
      decideSceneRecovery(
        entry,
        server,
        Date.parse("2026-07-19T18:00:00.000Z")
      )
    ).toBe("expired");
    expect(
      sceneRecoveryKey({
        accountId: "a",
        projectId: "b/c",
        sceneId: "d"
      })
    ).not.toBe(
      sceneRecoveryKey({
        accountId: "a/b",
        projectId: "c",
        sceneId: "d"
      })
    );
  });
});
