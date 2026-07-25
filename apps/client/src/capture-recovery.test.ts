import { blockId, type SceneDocumentV1 } from "@ghostwriter/editor";
import { describe, expect, it, vi } from "vitest";
import {
  createCaptureRecoveryCoordinator,
  createCaptureRecoveryService,
  decideCaptureRecovery,
  CAPTURE_RECOVERY_RETENTION_MS,
  captureRecoveryKey,
  type EncryptedCaptureRecoveryRecord,
  type CaptureRecoveryEncryptedStore,
  type CaptureRecoveryService
} from "./capture-recovery.js";
import { sceneRecoveryKey } from "./scene-recovery.js";

const scope = {
  accountId: "account-writer",
  projectId: "project-harbor",
  captureId: "capture-opening"
} as const;

function captureDocument(text: string): SceneDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: blockId("block-capture-recovery") },
          content: [{ type: "text", text }]
        }
      ]
    }
  };
}

function memoryEncryptedStore(): CaptureRecoveryEncryptedStore & {
  readonly records: Map<string, EncryptedCaptureRecoveryRecord>;
  encryptionKey(): CryptoKey | undefined;
} {
  const records = new Map<string, EncryptedCaptureRecoveryRecord>();
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

describe("capture recovery", () => {
  it("encrypts and decrypts one latest recovery with a non-exportable key", async () => {
    const store = memoryEncryptedStore();
    const local = captureDocument("A fleeting idea.");
    const service = createCaptureRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });

    await expect(service.save(scope, 4, local)).resolves.toBe(
      "encrypted-browser"
    );
    const encrypted = store.records.get(captureRecoveryKey(scope));
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
    const service: CaptureRecoveryService = {
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
    const coordinator = createCaptureRecoveryCoordinator({
      service,
      scope,
      scheduleSave
    });
    const local = captureDocument("Unacknowledged capture.");

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
    const service = createCaptureRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });
    const acknowledged = captureDocument("Acknowledged.");
    const local = captureDocument("Acknowledged, then changed locally.");
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
    const service = createCaptureRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => now
    });
    await service.save(scope, 1, captureDocument("Temporary capture."));

    now += CAPTURE_RECOVERY_RETENTION_MS;
    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser"
    });
    expect(store.records).toHaveLength(0);
  });

  it("clears only the signed-out account's recoveries", async () => {
    const store = memoryEncryptedStore();
    const service = createCaptureRecoveryService({
      store,
      crypto: webCrypto(),
      now: () => Date.parse("2026-07-12T18:00:00.000Z")
    });
    const otherScope = { ...scope, accountId: "account-other" };
    await service.save(scope, 1, captureDocument("Writer recovery."));
    await service.save(otherScope, 1, captureDocument("Other recovery."));

    await service.clearAccount(scope.accountId);

    await expect(service.load(scope)).resolves.toEqual({
      mode: "encrypted-browser"
    });
    await expect(service.load(otherScope)).resolves.toMatchObject({
      entry: { accountId: "account-other" }
    });
  });

  it("offers only a nonexpired recovery that differs from the server Capture", () => {
    const server = captureDocument("Server Capture.");
    const local = captureDocument("Local Capture.");
    const entry = {
      ...scope,
      expectedWorkingVersion: 2,
      document: local,
      updatedAt: "2026-07-12T18:00:00.000Z",
      expiresAt: "2026-07-19T18:00:00.000Z"
    } as const;

    expect(
      decideCaptureRecovery(
        entry,
        server,
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toBe("offer");
    expect(
      decideCaptureRecovery(
        { ...entry, document: server },
        server,
        Date.parse("2026-07-13T18:00:00.000Z")
      )
    ).toBe("matches-acknowledged");
    expect(
      decideCaptureRecovery(
        entry,
        server,
        Date.parse("2026-07-19T18:00:00.000Z")
      )
    ).toBe("expired");
    expect(
      captureRecoveryKey({
        accountId: "a",
        projectId: "b/c",
        captureId: "d"
      })
    ).not.toBe(
      captureRecoveryKey({
        accountId: "a/b",
        projectId: "c",
        captureId: "d"
      })
    );
  });

  it("does not share recovery keys with scene recovery for the same ids", () => {
    const sharedIds = {
      accountId: "account-writer",
      projectId: "project-harbor",
      entityId: "shared-id"
    };
    expect(
      captureRecoveryKey({
        accountId: sharedIds.accountId,
        projectId: sharedIds.projectId,
        captureId: sharedIds.entityId
      })
    ).not.toBe(
      sceneRecoveryKey({
        accountId: sharedIds.accountId,
        projectId: sharedIds.projectId,
        sceneId: sharedIds.entityId
      })
    );
  });
});
