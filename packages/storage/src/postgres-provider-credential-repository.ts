import {
  accountId,
  createOpenAiProviderCredentialEnvelope,
  OPENAI_PROVIDER_ID,
  type AccountId,
  type OpenAiProviderCredentialEnvelope,
  type ProviderCredentialRepository,
  type ProviderCredentialValidationState,
  type DeleteProviderCredentialOutcome,
  type MarkProviderCredentialValidationOutcome,
  type UpsertProviderCredentialOutcome
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { providerCredentials } from "./schema.js";

function envelopeFromRow(
  row: typeof providerCredentials.$inferSelect
): OpenAiProviderCredentialEnvelope {
  return createOpenAiProviderCredentialEnvelope({
    accountId: accountId(row.accountId),
    provider: OPENAI_PROVIDER_ID,
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

function envelopeToRow(envelope: OpenAiProviderCredentialEnvelope) {
  const candidate = createOpenAiProviderCredentialEnvelope(envelope);
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
    async get(id: AccountId): Promise<OpenAiProviderCredentialEnvelope | undefined> {
      const [row] = await db
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.accountId, id))
        .limit(1);
      return row === undefined ? undefined : envelopeFromRow(row);
    },

    async upsert(
      envelope: OpenAiProviderCredentialEnvelope,
      expectedVersion: number | undefined
    ): Promise<UpsertProviderCredentialOutcome> {
      const candidate = createOpenAiProviderCredentialEnvelope(envelope);
      const row = envelopeToRow(candidate);

      if (expectedVersion === undefined) {
        const [inserted] = await db
          .insert(providerCredentials)
          .values(row)
          .onConflictDoNothing({ target: providerCredentials.accountId })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "conflict" };
        }
        return { ok: true, envelope: envelopeFromRow(inserted) };
      }

      const [updated] = await db
        .update(providerCredentials)
        .set({
          provider: row.provider,
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
      expectedVersion: number
    ): Promise<DeleteProviderCredentialOutcome> {
      const [deleted] = await db
        .delete(providerCredentials)
        .where(
          and(
            eq(providerCredentials.accountId, id),
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
        .where(eq(providerCredentials.accountId, id))
        .limit(1);
      return existing === undefined
        ? { ok: false, reason: "not-found" }
        : { ok: false, reason: "conflict" };
    },

    async markValidation(input: Readonly<{
      accountId: AccountId;
      expectedVersion: number;
      validationState: ProviderCredentialValidationState;
      updatedAt: string;
      validatedAt?: string;
    }>): Promise<MarkProviderCredentialValidationOutcome> {
      const [existing] = await db
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.accountId, input.accountId))
        .limit(1);
      if (existing === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, reason: "conflict" };
      }

      const nextEnvelope = createOpenAiProviderCredentialEnvelope({
        accountId: accountId(existing.accountId),
        provider: OPENAI_PROVIDER_ID,
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
            eq(providerCredentials.version, input.expectedVersion)
          )
        )
        .returning();
      if (updated === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, envelope: envelopeFromRow(updated) };
    },

    async listByKekVersion(kekVersion: string): Promise<readonly OpenAiProviderCredentialEnvelope[]> {
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
          .returning({ accountId: providerCredentials.accountId });
        return deleted.length;
      });
    }
  });
}
