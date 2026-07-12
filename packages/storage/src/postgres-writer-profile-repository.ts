import {
  accountId,
  createWriterProfile,
  type AccountId,
  type WriterProfile,
  type WriterProfileRepository
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { writerProfiles } from "./schema.js";

function fromRow(row: typeof writerProfiles.$inferSelect): WriterProfile {
  return createWriterProfile({
    accountId: accountId(row.accountId),
    displayName: row.displayName,
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
        .values(candidate)
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
