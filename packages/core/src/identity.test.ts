import { describe, expect, it } from "vitest";
import {
  accountId,
  createIdentityServices,
  createMemoryWriterProfileRepository,
  ProfileConflictError
} from "./index.js";

describe("writer identity services", () => {
  it("idempotently bootstraps one profile without overwriting a writer choice", async () => {
    const profiles = createMemoryWriterProfileRepository();
    let now = "2026-07-11T18:30:00.000Z";
    const services = createIdentityServices({
      profiles,
      clock: { now: () => now }
    });
    const id = accountId("account-thomas");

    const created = await services.ensureWriterProfile({
      accountId: id,
      providerDisplayName: "  Thomas  "
    });
    now = "2026-07-11T18:31:00.000Z";
    const resumed = await services.ensureWriterProfile({
      accountId: id,
      providerDisplayName: "Provider Renamed Thomas"
    });

    expect(created).toEqual({
      accountId: id,
      displayName: "Thomas",
      version: 1,
      createdAt: "2026-07-11T18:30:00.000Z",
      updatedAt: "2026-07-11T18:30:00.000Z"
    });
    expect(resumed).toEqual(created);
  });

  it("updates a profile only from the expected version", async () => {
    const profiles = createMemoryWriterProfileRepository();
    const services = createIdentityServices({
      profiles,
      clock: { now: () => "2026-07-11T18:32:00.000Z" }
    });
    const id = accountId("account-thomas");
    const initial = await services.ensureWriterProfile({
      accountId: id,
      providerDisplayName: "Thomas"
    });
    const updated = await services.updateWriterProfile({
      accountId: id,
      displayName: "  Thomas Schlegel  ",
      expectedVersion: initial.version
    });

    expect(updated.displayName).toBe("Thomas Schlegel");
    await expect(
      services.updateWriterProfile({
        accountId: id,
        displayName: "Stale update",
        expectedVersion: initial.version
      })
    ).rejects.toBeInstanceOf(ProfileConflictError);
  });
});
