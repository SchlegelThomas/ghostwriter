import type { AccountId } from "./identity.js";
import type { Clock } from "./project-repository.js";
import type { ProviderCredentialRepository } from "./provider-credential-repository.js";
import {
  assertOpenAiProviderCredentialPlaintext,
  createOpenAiProviderCredentialEnvelope,
  createOpenAiProviderCredentialMaskedHint,
  encryptedMaterialFromEnvelope,
  OPENAI_PROVIDER_ID,
  ProviderCredentialAuthorizationError,
  ProviderCredentialConflictError,
  ProviderCredentialKeyRejectedError,
  ProviderCredentialNotFoundError,
  ProviderCredentialUnavailableError,
  providerCredentialStatusFromEnvelope,
  type ProviderCredentialCryptoPort,
  type ProviderCredentialRunAuthorization,
  type ProviderCredentialStatus,
  type ProviderCredentialValidationState
} from "./provider-credentials.js";

export type ProviderCredentialServices = Readonly<{
  getOpenAiCredentialStatus(accountId: AccountId): Promise<ProviderCredentialStatus | undefined>;
  setOpenAiCredential(input: Readonly<{
    accountId: AccountId;
    plaintext: string;
    expectedVersion?: number;
  }>): Promise<ProviderCredentialStatus>;
  deleteOpenAiCredential(input: Readonly<{
    accountId: AccountId;
    expectedVersion: number;
  }>): Promise<void>;
  markOpenAiCredentialValidation(input: Readonly<{
    accountId: AccountId;
    expectedVersion: number;
    validationState: ProviderCredentialValidationState;
  }>): Promise<ProviderCredentialStatus>;
  decryptOpenAiCredentialForAuthorizedRun(
    authorization: ProviderCredentialRunAuthorization
  ): Promise<string>;
  revokeOpenAiCredentialsForKekVersion(kekVersion: string): Promise<number>;
}>;

export type ProviderCredentialServiceDependencies = Readonly<{
  credentials: ProviderCredentialRepository;
  crypto: ProviderCredentialCryptoPort;
  clock: Clock;
}>;

function assertRunAuthorization(
  authorization: ProviderCredentialRunAuthorization
): AccountId {
  if (authorization.kind !== "backend-provider-adapter") {
    throw new ProviderCredentialAuthorizationError();
  }
  return authorization.accountId;
}

export function createProviderCredentialServices(
  dependencies: ProviderCredentialServiceDependencies
): ProviderCredentialServices {
  return Object.freeze({
    async getOpenAiCredentialStatus(accountId) {
      const envelope = await dependencies.credentials.get(accountId);
      return envelope === undefined
        ? undefined
        : providerCredentialStatusFromEnvelope(envelope);
    },

    async setOpenAiCredential(input) {
      let plaintext: string;
      try {
        plaintext = assertOpenAiProviderCredentialPlaintext(input.plaintext);
      } catch (error) {
        if (error instanceof ProviderCredentialKeyRejectedError) {
          throw error;
        }
        throw new ProviderCredentialKeyRejectedError();
      }

      const material = await dependencies.crypto.encrypt({
        accountId: input.accountId,
        provider: OPENAI_PROVIDER_ID,
        plaintext
      });
      const now = dependencies.clock.now();
      const existing = await dependencies.credentials.get(input.accountId);
      const nextVersion =
        existing === undefined ? 1 : existing.version + 1;
      const envelope = createOpenAiProviderCredentialEnvelope({
        accountId: input.accountId,
        provider: OPENAI_PROVIDER_ID,
        version: nextVersion,
        kekVersion: material.kekVersion,
        ciphertextB64: material.ciphertextB64,
        ivB64: material.ivB64,
        authTagB64: material.authTagB64,
        maskedHint: createOpenAiProviderCredentialMaskedHint(plaintext),
        validationState: "unvalidated",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });

      const outcome = await dependencies.credentials.upsert(
        envelope,
        existing === undefined ? undefined : input.expectedVersion
      );
      if (!outcome.ok) {
        if (outcome.reason === "not-found") {
          throw new ProviderCredentialConflictError();
        }
        throw new ProviderCredentialConflictError();
      }
      return providerCredentialStatusFromEnvelope(outcome.envelope);
    },

    async deleteOpenAiCredential(input) {
      const outcome = await dependencies.credentials.delete(
        input.accountId,
        input.expectedVersion
      );
      if (!outcome.ok) {
        if (outcome.reason === "not-found") {
          throw new ProviderCredentialNotFoundError();
        }
        throw new ProviderCredentialConflictError();
      }
    },

    async markOpenAiCredentialValidation(input) {
      const now = dependencies.clock.now();
      const outcome = await dependencies.credentials.markValidation({
        accountId: input.accountId,
        expectedVersion: input.expectedVersion,
        validationState: input.validationState,
        updatedAt: now,
        ...(input.validationState === "valid" ? { validatedAt: now } : {})
      });
      if (!outcome.ok) {
        if (outcome.reason === "not-found") {
          throw new ProviderCredentialNotFoundError();
        }
        throw new ProviderCredentialConflictError();
      }
      return providerCredentialStatusFromEnvelope(outcome.envelope);
    },

    async decryptOpenAiCredentialForAuthorizedRun(authorization) {
      const accountId = assertRunAuthorization(authorization);
      const envelope = await dependencies.credentials.get(accountId);
      if (envelope === undefined) {
        throw new ProviderCredentialNotFoundError();
      }
      if (envelope.validationState !== "valid") {
        throw new ProviderCredentialUnavailableError();
      }
      if (envelope.accountId !== accountId || envelope.provider !== OPENAI_PROVIDER_ID) {
        throw new ProviderCredentialUnavailableError();
      }
      return dependencies.crypto.decrypt({
        accountId: envelope.accountId,
        provider: envelope.provider,
        material: encryptedMaterialFromEnvelope(envelope)
      });
    },

    async revokeOpenAiCredentialsForKekVersion(kekVersion) {
      return dependencies.credentials.deleteByKekVersion(kekVersion.trim());
    }
  });
}
