import { afterEach, describe, expect, it } from "vitest";
import {
  accountId,
  createIdentityServices,
  ProfileConflictError
} from "@ghostwriter/core";
import { toRepositoryDatabase } from "./client.js";
import {
  createPgliteDatabase,
  migratePgliteRepositoryDatabase
} from "./pglite.js";
import { createPostgresWriterProfileRepository } from "./postgres-writer-profile-repository.js";
import { user } from "./schema.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

describe("Postgres writer profile repository", () => {
  it("bootstraps once and enforces compare-and-set updates", async () => {
    const { db, close } = createPgliteDatabase();
    closers.push(close);
    await migratePgliteRepositoryDatabase(db);
    await db.insert(user).values({
      id: "account-writer",
      name: "Provider Name",
      email: "writer@example.test",
      emailVerified: true
    });
    const profiles = createPostgresWriterProfileRepository(toRepositoryDatabase(db));
    let now = "2026-07-11T18:30:00.000Z";
    const services = createIdentityServices({
      profiles,
      clock: { now: () => now }
    });
    const id = accountId("account-writer");

    const created = await services.ensureWriterProfile({
      accountId: id,
      providerDisplayName: "Provider Name"
    });
    now = "2026-07-11T18:31:00.000Z";
    const resumed = await services.ensureWriterProfile({
      accountId: id,
      providerDisplayName: "Changed Provider Name"
    });
    const updated = await services.updateWriterProfile({
      accountId: id,
      displayName: "Writer Choice",
      expectedVersion: created.version
    });

    expect(resumed).toEqual(created);
    expect(updated.displayName).toBe("Writer Choice");
    await expect(
      services.updateWriterProfile({
        accountId: id,
        displayName: "Stale",
        expectedVersion: created.version
      })
    ).rejects.toBeInstanceOf(ProfileConflictError);
  });
});
