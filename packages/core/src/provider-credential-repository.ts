import type { AccountId } from "./identity.js";
import type {
  ProviderCredentialEnvelope,
  ProviderCredentialValidationState,
  ProviderId
} from "./provider-credentials.js";

export type UpsertProviderCredentialOutcome =
  | Readonly<{ ok: true; envelope: ProviderCredentialEnvelope }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export type DeleteProviderCredentialOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export type MarkProviderCredentialValidationOutcome =
  | Readonly<{ ok: true; envelope: ProviderCredentialEnvelope }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export interface ProviderCredentialRepository {
  get(
    accountId: AccountId,
    providerId: ProviderId
  ): Promise<ProviderCredentialEnvelope | undefined>;
  listForAccount(accountId: AccountId): Promise<readonly ProviderCredentialEnvelope[]>;
  upsert(
    envelope: ProviderCredentialEnvelope,
    expectedVersion: number | undefined
  ): Promise<UpsertProviderCredentialOutcome>;
  delete(
    accountId: AccountId,
    providerId: ProviderId,
    expectedVersion: number
  ): Promise<DeleteProviderCredentialOutcome>;
  markValidation(input: Readonly<{
    accountId: AccountId;
    providerId: ProviderId;
    expectedVersion: number;
    validationState: ProviderCredentialValidationState;
    updatedAt: string;
    validatedAt?: string;
  }>): Promise<MarkProviderCredentialValidationOutcome>;
  listByKekVersion(kekVersion: string): Promise<readonly ProviderCredentialEnvelope[]>;
  deleteByKekVersion(kekVersion: string): Promise<number>;
}
