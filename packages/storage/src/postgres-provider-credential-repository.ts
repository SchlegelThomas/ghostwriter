import {
  accountId,
  assertProviderId,
  createProviderCredentialEnvelope,
  type AccountId,
  type ProviderCredentialEnvelope,
  type ProviderCredentialRepository,
  type ProviderCredentialValidationState,
  type ProviderId,
  type DeleteProviderCredentialOutcome,
  type MarkProviderCredentialValidationOutcome,
  type UpsertProviderCredentialOutcome
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { providerCredentials } from "./schema.js";

function envelopeFromRow(
  row: typeof providerCredentials.$inferSelect
): ProviderCredentialEnvelope {
  return createProviderCredentialEnvelope({
    accountId: accountId(row.accountId),
    provider: assertProviderId(row.provider),
    version: row.version,
    kekVersion: row.kekVersion,
    ciphertextB64: row.ciphertextB64,
    ivB64: row.ivB64,
    authTagB64: row.authTagB64,
    maskedHint: row.maskedHint,
    validationState: row.validationState as ProviderCredentialValidationState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.validatedAt === null ? {} : { validatedAt: row.validatedAt })
  });
}

function envelopeToRow(envelope: ProviderCredentialEnvelope) {
  const candidate = createProviderCredentialEnvelope(envelope);
  return {
    accountId: candidate.accountId,
    provider: candidate.provider,
    version: candidate.version,
    kekVersion: candidate.kekVersion,
    ciphertextB64: candidate.ciphertextB64,
    ivB64: candidate.ivB64,
    authTagB64: candidate.authTagB64,
    maskedHint: candidate.maskedHint,
    validationState: candidate.validationState,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    validatedAt: candidate.validatedAt ?? null
  };
}

export function createPostgresProviderCredentialRepository(
  db: RepositoryDatabase
): ProviderCredentialRepository {
  return Object.freeze({
    async get(
      id: AccountId,
      providerId: ProviderId
    ): Promise<ProviderCredentialEnvelope | undefined> {
      const [row] = await db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.accountId, id),
            eq(providerCredentials.provider, providerId)
          )
        )
        .limit(1);
      return row === undefined ? undefined : envelopeFromRow(row);
    },

    async listForAccount(id: AccountId): Promise<readonly ProviderCredentialEnvelope[]> {
      const rows = await db
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.accountId, id));
      return Object.freeze(rows.map(envelopeFromRow));
    },

    async upsert(
      envelope: ProviderCredentialEnvelope,
      expectedVersion: number | undefined
    ): Promise<UpsertProviderCredentialOutcome> {
      const candidate = createProviderCredentialEnvelope(envelope);
      const row = envelopeToRow(candidate);

      if (expectedVersion === undefined) {
        const [inserted] = await db
          .insert(providerCredentials)
          .values(row)
          .onConflictDoNothing({
            target: [providerCredentials.accountId, providerCredentials.provider]
          })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "conflict" };
        }
        return { ok: true, envelope: envelopeFromRow(inserted) };
      }

      const [updated] = await db
        .update(providerCredentials)
        .set({
          version: row.version,
          kekVersion: row.kekVersion,
          ciphertextB64: row.ciphertextB64,
          ivB64: row.ivB64,
          authTagB64: row.authTagB64,
          maskedHint: row.maskedHint,
          validationState: row.validationState,
          updatedAt: row.updatedAt,
          validatedAt: row.validatedAt
        })
        .where(
          and(
            eq(providerCredentials.accountId, candidate.accountId),
            eq(providerCredentials.provider, candidate.provider),
            eq(providerCredentials.version, expectedVersion)
          )
        )
        .returning();
      if (updated === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, envelope: envelopeFromRow(updated) };
    },

    async delete(
      id: AccountId,
      providerId: ProviderId,
      expectedVersion: number
    ): Promise<DeleteProviderCredentialOutcome> {
      const [deleted] = await db
        .delete(providerCredentials)
        .where(
          and(
            eq(providerCredentials.accountId, id),
            eq(providerCredentials.provider, providerId),
            eq(providerCredentials.version, expectedVersion)
          )
        )
        .returning();
      if (deleted !== undefined) {
        return { ok: true };
      }
      const [existing] = await db
        .select({ version: providerCredentials.version })
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.accountId, id),
            eq(providerCredentials.provider, providerId)
          )
        )
        .limit(1);
      return existing === undefined
        ? { ok: false, reason: "not-found" }
        : { ok: false, reason: "conflict" };
    },

    async markValidation(input: Readonly<{
      accountId: AccountId;
      providerId: ProviderId;
      expectedVersion: number;
      validationState: ProviderCredentialValidationState;
      updatedAt: string;
      validatedAt?: string;
    }>): Promise<MarkProviderCredentialValidationOutcome> {
      const [existing] = await db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.accountId, input.accountId),
            eq(providerCredentials.provider, input.providerId)
          )
        )
        .limit(1);
      if (existing === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, reason: "conflict" };
      }

      const nextEnvelope = createProviderCredentialEnvelope({
        accountId: accountId(existing.accountId),
        provider: assertProviderId(existing.provider),
        version: existing.version,
        kekVersion: existing.kekVersion,
        ciphertextB64: existing.ciphertextB64,
        ivB64: existing.ivB64,
        authTagB64: existing.authTagB64,
        maskedHint: existing.maskedHint,
        validationState: input.validationState,
        createdAt: existing.createdAt,
        updatedAt: input.updatedAt,
        ...(input.validationState === "valid" && input.validatedAt !== undefined
          ? { validatedAt: input.validatedAt }
          : {})
      });

      const [updated] = await db
        .update(providerCredentials)
        .set({
          validationState: nextEnvelope.validationState,
          updatedAt: nextEnvelope.updatedAt,
          validatedAt: nextEnvelope.validatedAt ?? null
        })
        .where(
          and(
            eq(providerCredentials.accountId, input.accountId),
            eq(providerCredentials.provider, input.providerId),
            eq(providerCredentials.version, input.expectedVersion)
          )
        )
        .returning();
      if (updated === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, envelope: envelopeFromRow(updated) };
    },

    async listByKekVersion(kekVersion: string): Promise<readonly ProviderCredentialEnvelope[]> {
      const normalized = kekVersion.trim();
      const rows = await db
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.kekVersion, normalized));
      return Object.freeze(rows.map(envelopeFromRow));
    },

    async deleteByKekVersion(kekVersion: string): Promise<number> {
      const normalized = kekVersion.trim();
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(providerCredentials)
          .where(eq(providerCredentials.kekVersion, normalized))
          .returning({
            accountId: providerCredentials.accountId,
            provider: providerCredentials.provider
          });
        return deleted.length;
      });
    }
  });
}
