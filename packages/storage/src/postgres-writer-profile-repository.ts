import {
  accountId,
  createWriterProfile,
  createWriterPublishingDetails,
  type AccountId,
  type WriterProfile,
  type WriterProfileRepository,
  type WriterPublishingDetails
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { writerProfiles } from "./schema.js";

function publishingFromRow(
  value: unknown
): WriterPublishingDetails | undefined {
  if (value === null || value === undefined || typeof value !== "object") {
    return undefined;
  }
  return createWriterPublishingDetails(value as WriterPublishingDetails);
}

function fromRow(row: typeof writerProfiles.$inferSelect): WriterProfile {
  const publishing = publishingFromRow(row.publishing);
  return createWriterProfile({
    accountId: accountId(row.accountId),
    displayName: row.displayName,
    ...(publishing === undefined ? {} : { publishing }),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

export function createPostgresWriterProfileRepository(
  db: RepositoryDatabase
): WriterProfileRepository {
  return Object.freeze({
    async get(id: AccountId): Promise<WriterProfile | undefined> {
      const [row] = await db
        .select()
        .from(writerProfiles)
        .where(eq(writerProfiles.accountId, id))
        .limit(1);
      return row === undefined ? undefined : fromRow(row);
    },
    async createIfMissing(profile: WriterProfile): Promise<WriterProfile> {
      const candidate = createWriterProfile(profile);
      await db
        .insert(writerProfiles)
        .values({
          accountId: candidate.accountId,
          displayName: candidate.displayName,
          publishing: candidate.publishing ?? null,
          version: candidate.version,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt
        })
        .onConflictDoNothing({ target: writerProfiles.accountId });

      const [row] = await db
        .select()
        .from(writerProfiles)
        .where(eq(writerProfiles.accountId, candidate.accountId))
        .limit(1);

      if (row === undefined) {
        throw new Error("Writer profile insert completed without a readable profile.");
      }
      return fromRow(row);
    },
    async update(
      profile: WriterProfile,
      expectedVersion: number
    ): Promise<WriterProfile | undefined> {
      const candidate = createWriterProfile(profile);
      const [row] = await db
        .update(writerProfiles)
        .set({
          displayName: candidate.displayName,
          publishing: candidate.publishing ?? null,
          version: candidate.version,
          updatedAt: candidate.updatedAt
        })
        .where(
          and(
            eq(writerProfiles.accountId, candidate.accountId),
            eq(writerProfiles.version, expectedVersion)
          )
        )
        .returning();
      return row === undefined ? undefined : fromRow(row);
    }
  });
}
