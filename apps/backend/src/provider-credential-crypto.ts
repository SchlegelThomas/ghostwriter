import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  OPENAI_PROVIDER_ID,
  PROVIDER_CREDENTIAL_ENVELOPE_FORMAT_VERSION,
  ProviderCredentialCryptoContextError,
  type AccountId,
  type ProviderId,
  type ProviderCredentialCryptoPort,
  type ProviderCredentialDecryptInput,
  type ProviderCredentialEncryptInput,
  type ProviderCredentialEncryptedMaterial
} from "@ghostwriter/core";
import type { ProviderKekRuntimeConfig } from "./provider-kek-config.js";

const GCM_IV_BYTE_LENGTH = 12;
const GCM_TAG_BYTE_LENGTH = 16;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

function credentialAdditionalAuthenticatedData(
  accountId: AccountId,
  provider: ProviderId
): Buffer {
  const canonical = `${PROVIDER_CREDENTIAL_ENVELOPE_FORMAT_VERSION}|${accountId}|${provider}`;
  return Buffer.from(canonical, "utf8");
}

function requireBase64Field(value: string): Buffer {
  const normalized = value.trim();
  if (normalized.length === 0 || !BASE64_PATTERN.test(normalized)) {
    throw new ProviderCredentialCryptoContextError();
  }
  return Buffer.from(normalized, "base64");
}

export function createNodeProviderCredentialCrypto(
  config: ProviderKekRuntimeConfig
): ProviderCredentialCryptoPort {
  return Object.freeze({
    async encrypt(
      input: ProviderCredentialEncryptInput
    ): Promise<ProviderCredentialEncryptedMaterial> {
      const key = config.keys.get(config.activeVersion);
      if (key === undefined) {
        throw new ProviderCredentialCryptoContextError();
      }
      const iv = randomBytes(GCM_IV_BYTE_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: GCM_TAG_BYTE_LENGTH
      });
      cipher.setAAD(
        credentialAdditionalAuthenticatedData(input.accountId, input.provider)
      );
      const ciphertext = Buffer.concat([
        cipher.update(input.plaintext, "utf8"),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();
      return Object.freeze({
        kekVersion: config.activeVersion,
        ciphertextB64: ciphertext.toString("base64"),
        ivB64: iv.toString("base64"),
        authTagB64: authTag.toString("base64")
      });
    },

    async decrypt(input: ProviderCredentialDecryptInput): Promise<string> {
      const key = config.keys.get(input.material.kekVersion.trim());
      if (key === undefined) {
        throw new ProviderCredentialCryptoContextError();
      }
      let iv: Buffer;
      let ciphertext: Buffer;
      let authTag: Buffer;
      try {
        iv = requireBase64Field(input.material.ivB64);
        ciphertext = requireBase64Field(input.material.ciphertextB64);
        authTag = requireBase64Field(input.material.authTagB64);
      } catch (error) {
        if (error instanceof ProviderCredentialCryptoContextError) {
          throw error;
        }
        throw new ProviderCredentialCryptoContextError();
      }
      if (iv.length !== GCM_IV_BYTE_LENGTH || authTag.length !== GCM_TAG_BYTE_LENGTH) {
        throw new ProviderCredentialCryptoContextError();
      }

      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv, {
          authTagLength: GCM_TAG_BYTE_LENGTH
        });
        decipher.setAAD(
          credentialAdditionalAuthenticatedData(input.accountId, input.provider)
        );
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final()
        ]).toString("utf8");
        return plaintext;
      } catch {
        throw new ProviderCredentialCryptoContextError();
      }
    }
  });
}

export function createUnavailableProviderCredentialCrypto(): ProviderCredentialCryptoPort {
  const unavailable = async (): Promise<never> => {
    throw new ProviderCredentialCryptoContextError();
  };
  return Object.freeze({
    encrypt: unavailable,
    decrypt: unavailable
  });
}

/** Exposed for tests that assert AAD binding. */
export function providerCredentialAadForTests(
  accountId: AccountId,
  provider: ProviderId = OPENAI_PROVIDER_ID
): string {
  return credentialAdditionalAuthenticatedData(accountId, provider).toString("utf8");
}
