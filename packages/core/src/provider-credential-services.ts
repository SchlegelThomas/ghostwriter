import type { AccountId } from "./identity.js";
import type { Clock } from "./project-repository.js";
import type { ProviderCredentialRepository } from "./provider-credential-repository.js";
import {
  assertOpenAiProviderCredentialPlaintext,
  assertProviderCredentialPlaintext,
  createProviderCredentialEnvelope,
  createProviderCredentialMaskedHint,
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
  type ProviderCredentialValidationState,
  type ProviderId
} from "./provider-credentials.js";

export type ProviderCredentialServices = Readonly<{
  listCredentialStatuses(accountId: AccountId): Promise<readonly ProviderCredentialStatus[]>;
  getCredentialStatus(
    accountId: AccountId,
    providerId: ProviderId
  ): Promise<ProviderCredentialStatus | undefined>;
  setCredential(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    plaintext: string;
    expectedVersion?: number;
  }>): Promise<ProviderCredentialStatus>;
  deleteCredential(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
  }>): Promise<void>;
  markCredentialValidation(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
    validationState: ProviderCredentialValidationState;
  }>): Promise<ProviderCredentialStatus>;
  decryptCredentialForAuthorizedRun(
    authorization: ProviderCredentialRunAuthorization,
    providerId: ProviderId
  ): Promise<string>;
  revokeCredentialsForKekVersion(kekVersion: string): Promise<number>;
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
  async function listCredentialStatuses(
    accountId: AccountId
  ): Promise<readonly ProviderCredentialStatus[]> {
    const envelopes = await dependencies.credentials.listForAccount(accountId);
    return Object.freeze(envelopes.map(providerCredentialStatusFromEnvelope));
  }

  async function getCredentialStatus(
    accountId: AccountId,
    providerId: ProviderId
  ): Promise<ProviderCredentialStatus | undefined> {
    const envelope = await dependencies.credentials.get(accountId, providerId);
    return envelope === undefined
      ? undefined
      : providerCredentialStatusFromEnvelope(envelope);
  }

  async function setCredential(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    plaintext: string;
    expectedVersion?: number;
  }>): Promise<ProviderCredentialStatus> {
    let plaintext: string;
    try {
      plaintext = assertProviderCredentialPlaintext(input.providerId, input.plaintext);
    } catch (error) {
      if (error instanceof ProviderCredentialKeyRejectedError) {
        throw error;
      }
      throw new ProviderCredentialKeyRejectedError();
    }

    const material = await dependencies.crypto.encrypt({
      accountId: input.accountId,
      provider: input.providerId,
      plaintext
    });
    const now = dependencies.clock.now();
    const existing = await dependencies.credentials.get(input.accountId, input.providerId);
    const nextVersion = existing === undefined ? 1 : existing.version + 1;
    const envelope = createProviderCredentialEnvelope({
      accountId: input.accountId,
      provider: input.providerId,
      version: nextVersion,
      kekVersion: material.kekVersion,
      ciphertextB64: material.ciphertextB64,
      ivB64: material.ivB64,
      authTagB64: material.authTagB64,
      maskedHint: createProviderCredentialMaskedHint(plaintext),
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
  }

  async function deleteCredential(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
  }>): Promise<void> {
    const outcome = await dependencies.credentials.delete(
      input.accountId,
      input.providerId,
      input.expectedVersion
    );
    if (!outcome.ok) {
      if (outcome.reason === "not-found") {
        throw new ProviderCredentialNotFoundError();
      }
      throw new ProviderCredentialConflictError();
    }
  }

  async function markCredentialValidation(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
    validationState: ProviderCredentialValidationState;
  }>): Promise<ProviderCredentialStatus> {
    const now = dependencies.clock.now();
    const outcome = await dependencies.credentials.markValidation({
      accountId: input.accountId,
      providerId: input.providerId,
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
  }

  async function decryptCredentialForAuthorizedRun(
    authorization: ProviderCredentialRunAuthorization,
    providerId: ProviderId
  ): Promise<string> {
    const accountId = assertRunAuthorization(authorization);
    const envelope = await dependencies.credentials.get(accountId, providerId);
    if (envelope === undefined) {
      throw new ProviderCredentialNotFoundError();
    }
    if (envelope.validationState !== "valid") {
      throw new ProviderCredentialUnavailableError();
    }
    if (envelope.accountId !== accountId || envelope.provider !== providerId) {
      throw new ProviderCredentialUnavailableError();
    }
    return dependencies.crypto.decrypt({
      accountId: envelope.accountId,
      provider: envelope.provider,
      material: encryptedMaterialFromEnvelope(envelope)
    });
  }

  async function revokeCredentialsForKekVersion(kekVersion: string): Promise<number> {
    return dependencies.credentials.deleteByKekVersion(kekVersion.trim());
  }

  return Object.freeze({
    listCredentialStatuses,
    getCredentialStatus,
    setCredential,
    deleteCredential,
    markCredentialValidation,
    decryptCredentialForAuthorizedRun,
    revokeCredentialsForKekVersion,
    getOpenAiCredentialStatus: (accountId) =>
      getCredentialStatus(accountId, OPENAI_PROVIDER_ID),
    setOpenAiCredential: async (input) => {
      let plaintext: string;
      try {
        plaintext = assertOpenAiProviderCredentialPlaintext(input.plaintext);
      } catch (error) {
        if (error instanceof ProviderCredentialKeyRejectedError) {
          throw error;
        }
        throw new ProviderCredentialKeyRejectedError();
      }
      return setCredential({
        accountId: input.accountId,
        providerId: OPENAI_PROVIDER_ID,
        plaintext,
        ...(input.expectedVersion === undefined
          ? {}
          : { expectedVersion: input.expectedVersion })
      });
    },
    deleteOpenAiCredential: (input) =>
      deleteCredential({
        accountId: input.accountId,
        providerId: OPENAI_PROVIDER_ID,
        expectedVersion: input.expectedVersion
      }),
    markOpenAiCredentialValidation: (input) =>
      markCredentialValidation({
        accountId: input.accountId,
        providerId: OPENAI_PROVIDER_ID,
        expectedVersion: input.expectedVersion,
        validationState: input.validationState
      }),
    decryptOpenAiCredentialForAuthorizedRun: (authorization) =>
      decryptCredentialForAuthorizedRun(authorization, OPENAI_PROVIDER_ID),
    revokeOpenAiCredentialsForKekVersion: revokeCredentialsForKekVersion
  });
}
