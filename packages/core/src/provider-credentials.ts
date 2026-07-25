import { DomainValidationError } from "./domain.js";
import type { AccountId } from "./identity.js";

export const OPENAI_PROVIDER_ID = "openai" as const;

export type OpenAiProviderId = typeof OPENAI_PROVIDER_ID;

export const PROVIDER_CREDENTIAL_VALIDATION_STATES = Object.freeze([
  "unvalidated",
  "valid",
  "invalid",
  "revoked"
] as const);

export type ProviderCredentialValidationState =
  (typeof PROVIDER_CREDENTIAL_VALIDATION_STATES)[number];

export type ProviderCredentialEncryptedMaterial = Readonly<{
  kekVersion: string;
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}>;

export type OpenAiProviderCredentialEnvelope = Readonly<{
  accountId: AccountId;
  provider: OpenAiProviderId;
  version: number;
  kekVersion: string;
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
  maskedHint: string;
  validationState: ProviderCredentialValidationState;
  createdAt: string;
  updatedAt: string;
  validatedAt?: string;
}>;

export type ProviderCredentialStatus = Readonly<{
  provider: OpenAiProviderId;
  version: number;
  maskedHint: string;
  validationState: ProviderCredentialValidationState;
  createdAt: string;
  updatedAt: string;
  validatedAt?: string;
}>;

export const PROVIDER_CREDENTIAL_ENVELOPE_FORMAT_VERSION = "1" as const;

export type ProviderCredentialEncryptInput = Readonly<{
  accountId: AccountId;
  provider: OpenAiProviderId;
  plaintext: string;
}>;

export type ProviderCredentialDecryptInput = Readonly<{
  accountId: AccountId;
  provider: OpenAiProviderId;
  material: ProviderCredentialEncryptedMaterial;
}>;

export type ProviderCredentialCryptoPort = Readonly<{
  encrypt(input: ProviderCredentialEncryptInput): Promise<ProviderCredentialEncryptedMaterial>;
  decrypt(input: ProviderCredentialDecryptInput): Promise<string>;
}>;

export type ProviderCredentialRunAuthorization = Readonly<{
  kind: "backend-provider-adapter";
  accountId: AccountId;
}>;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const OPENAI_KEY_MIN_LENGTH = 20;
const OPENAI_KEY_MAX_LENGTH = 200;

function requireBase64Field(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || !BASE64_PATTERN.test(normalized)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      `${field} must be valid base64 material.`
    );
  }
  return normalized;
}

function requireKekVersion(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64 || /\s/u.test(normalized)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Key encryption key version is not recognized."
    );
  }
  return normalized;
}

function requireMaskedHint(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 32 || /\s/u.test(normalized)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Credential hint is not recognized."
    );
  }
  return normalized;
}

function requireValidationState(value: ProviderCredentialValidationState): ProviderCredentialValidationState {
  if (!PROVIDER_CREDENTIAL_VALIDATION_STATES.includes(value)) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Credential validation state is not recognized."
    );
  }
  return value;
}

export function createOpenAiProviderCredentialMaskedHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length < 4) {
    return "****";
  }
  return `…${trimmed.slice(-4)}`;
}

export function assertOpenAiProviderCredentialPlaintext(plaintext: string): string {
  const normalized = plaintext.trim();
  if (
    normalized.length < OPENAI_KEY_MIN_LENGTH ||
    normalized.length > OPENAI_KEY_MAX_LENGTH ||
    /\s/u.test(normalized)
  ) {
    throw new ProviderCredentialKeyRejectedError();
  }
  return normalized;
}

export function createOpenAiProviderCredentialEnvelope(
  input: OpenAiProviderCredentialEnvelope
): OpenAiProviderCredentialEnvelope {
  return Object.freeze({
    accountId: input.accountId,
    provider: OPENAI_PROVIDER_ID,
    version: requirePositiveCredentialVersion(input.version),
    kekVersion: requireKekVersion(input.kekVersion),
    ciphertextB64: requireBase64Field(input.ciphertextB64, "Credential ciphertext"),
    ivB64: requireBase64Field(input.ivB64, "Credential initialization vector"),
    authTagB64: requireBase64Field(input.authTagB64, "Credential authentication tag"),
    maskedHint: requireMaskedHint(input.maskedHint),
    validationState: requireValidationState(input.validationState),
    createdAt: requireTimestamp(input.createdAt, "Credential creation time"),
    updatedAt: requireTimestamp(input.updatedAt, "Credential update time"),
    ...(input.validatedAt === undefined
      ? {}
      : { validatedAt: requireTimestamp(input.validatedAt, "Credential validation time") })
  });
}

export function providerCredentialStatusFromEnvelope(
  envelope: OpenAiProviderCredentialEnvelope
): ProviderCredentialStatus {
  return Object.freeze({
    provider: envelope.provider,
    version: envelope.version,
    maskedHint: envelope.maskedHint,
    validationState: envelope.validationState,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    ...(envelope.validatedAt === undefined ? {} : { validatedAt: envelope.validatedAt })
  });
}

export function encryptedMaterialFromEnvelope(
  envelope: OpenAiProviderCredentialEnvelope
): ProviderCredentialEncryptedMaterial {
  return Object.freeze({
    kekVersion: envelope.kekVersion,
    ciphertextB64: envelope.ciphertextB64,
    ivB64: envelope.ivB64,
    authTagB64: envelope.authTagB64
  });
}

function requirePositiveCredentialVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Credential version must be a positive integer."
    );
  }
  return value;
}

function requireTimestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", `${field} must not be empty.`);
  }
  return normalized;
}

export class ProviderCredentialNotFoundError extends Error {
  constructor() {
    super("No provider credential is configured for this account.");
    this.name = "ProviderCredentialNotFoundError";
  }
}

export class ProviderCredentialConflictError extends Error {
  constructor() {
    super("The provider credential changed since it was loaded.");
    this.name = "ProviderCredentialConflictError";
  }
}

export class ProviderCredentialKeyRejectedError extends Error {
  constructor() {
    super("The provider credential could not be accepted.");
    this.name = "ProviderCredentialKeyRejectedError";
  }
}

export class ProviderCredentialUnavailableError extends Error {
  constructor() {
    super("The provider credential is not available for authorized use.");
    this.name = "ProviderCredentialUnavailableError";
  }
}

export class ProviderCredentialAuthorizationError extends Error {
  constructor() {
    super("Provider credential decryption is not authorized.");
    this.name = "ProviderCredentialAuthorizationError";
  }
}

export class ProviderCredentialCryptoContextError extends Error {
  constructor() {
    super("The provider credential envelope could not be decrypted.");
    this.name = "ProviderCredentialCryptoContextError";
  }
}
