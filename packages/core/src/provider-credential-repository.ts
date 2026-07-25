import type { AccountId } from "./identity.js";
import type {
  OpenAiProviderCredentialEnvelope,
  ProviderCredentialValidationState
} from "./provider-credentials.js";

export type UpsertProviderCredentialOutcome =
  | Readonly<{ ok: true; envelope: OpenAiProviderCredentialEnvelope }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export type DeleteProviderCredentialOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export type MarkProviderCredentialValidationOutcome =
  | Readonly<{ ok: true; envelope: OpenAiProviderCredentialEnvelope }>
  | Readonly<{ ok: false; reason: "conflict" | "not-found" }>;

export interface ProviderCredentialRepository {
  get(accountId: AccountId): Promise<OpenAiProviderCredentialEnvelope | undefined>;
  upsert(
    envelope: OpenAiProviderCredentialEnvelope,
    expectedVersion: number | undefined
  ): Promise<UpsertProviderCredentialOutcome>;
  delete(accountId: AccountId, expectedVersion: number): Promise<DeleteProviderCredentialOutcome>;
  markValidation(input: Readonly<{
    accountId: AccountId;
    expectedVersion: number;
    validationState: ProviderCredentialValidationState;
    updatedAt: string;
    validatedAt?: string;
  }>): Promise<MarkProviderCredentialValidationOutcome>;
  listByKekVersion(
    kekVersion: string
  ): Promise<readonly OpenAiProviderCredentialEnvelope[]>;
  deleteByKekVersion(kekVersion: string): Promise<number>;
}
