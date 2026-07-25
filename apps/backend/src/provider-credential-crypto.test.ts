import { describe, expect, it } from "vitest";
import { accountId, OPENAI_PROVIDER_ID, ProviderCredentialCryptoContextError } from "@ghostwriter/core";
import {
  createNodeProviderCredentialCrypto,
  providerCredentialAadForTests
} from "./provider-credential-crypto.js";
import {
  createTestProviderKekRuntimeConfig,
  type ProviderKekRuntimeConfig
} from "./provider-kek-config.js";

const OWNER = accountId("account-crypto-test");
const PLAINTEXT = "sk-openai-test-key-1234567890";

function runtimeWithVersions(
  versions: Readonly<Record<string, number>>,
  activeVersion: string
): ProviderKekRuntimeConfig {
  const keys = new Map<string, Buffer>();
  for (const [version, fill] of Object.entries(versions)) {
    keys.set(version, Buffer.alloc(32, fill));
  }
  return Object.freeze({
    keys: Object.freeze(keys),
    activeVersion
  });
}

describe("node provider credential crypto", () => {
  it("roundtrips with random IVs and active KEK version", async () => {
    const crypto = createNodeProviderCredentialCrypto(createTestProviderKekRuntimeConfig());
    const first = await crypto.encrypt({
      accountId: OWNER,
      provider: OPENAI_PROVIDER_ID,
      plaintext: PLAINTEXT
    });
    const second = await crypto.encrypt({
      accountId: OWNER,
      provider: OPENAI_PROVIDER_ID,
      plaintext: PLAINTEXT
    });
    expect(first.ivB64).not.toBe(second.ivB64);
    expect(first.kekVersion).toBe("V1");
    await expect(
      crypto.decrypt({
        accountId: OWNER,
        provider: OPENAI_PROVIDER_ID,
        material: first
      })
    ).resolves.toBe(PLAINTEXT);
  });

  it("decrypts with retired KEK versions and encrypts with the active KEK", async () => {
    const v1Crypto = createNodeProviderCredentialCrypto(
      runtimeWithVersions({ V1: 3, V2: 9 }, "V1")
    );
    const legacyMaterial = await v1Crypto.encrypt({
      accountId: OWNER,
      provider: OPENAI_PROVIDER_ID,
      plaintext: PLAINTEXT
    });
    const rotatedCrypto = createNodeProviderCredentialCrypto(
      runtimeWithVersions({ V1: 3, V2: 9 }, "V2")
    );
    const rotated = await rotatedCrypto.encrypt({
      accountId: OWNER,
      provider: OPENAI_PROVIDER_ID,
      plaintext: PLAINTEXT
    });
    expect(legacyMaterial.kekVersion).toBe("V1");
    expect(rotated.kekVersion).toBe("V2");
    await expect(
      rotatedCrypto.decrypt({
        accountId: OWNER,
        provider: OPENAI_PROVIDER_ID,
        material: legacyMaterial
      })
    ).resolves.toBe(PLAINTEXT);
  });

  it("rejects wrong account, tag, and KEK without leaking secrets", async () => {
    const crypto = createNodeProviderCredentialCrypto(createTestProviderKekRuntimeConfig());
    const material = await crypto.encrypt({
      accountId: OWNER,
      provider: OPENAI_PROVIDER_ID,
      plaintext: PLAINTEXT
    });
    const attempts = [
      crypto.decrypt({
        accountId: accountId("account-other"),
        provider: OPENAI_PROVIDER_ID,
        material
      }),
      crypto.decrypt({
        accountId: OWNER,
        provider: OPENAI_PROVIDER_ID,
        material: { ...material, authTagB64: Buffer.alloc(16, 1).toString("base64") }
      }),
      crypto.decrypt({
        accountId: OWNER,
        provider: OPENAI_PROVIDER_ID,
        material: { ...material, kekVersion: "V9" }
      })
    ];
    const results = await Promise.allSettled(attempts);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ProviderCredentialCryptoContextError);
        expect(JSON.stringify(result.reason)).not.toContain(PLAINTEXT);
      }
    }
    expect(providerCredentialAadForTests(OWNER)).toContain(OWNER);
  });
});
