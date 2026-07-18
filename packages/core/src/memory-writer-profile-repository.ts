import {
  createWriterProfile,
  type AccountId,
  type WriterProfile,
  type WriterProfileRepository
} from "./identity.js";

export function createMemoryWriterProfileRepository(
  seeds: readonly WriterProfile[] = []
): WriterProfileRepository {
  const profiles = new Map<AccountId, WriterProfile>(
    seeds.map((profile) => [profile.accountId, createWriterProfile(profile)])
  );

  return Object.freeze({
    async get(id: AccountId): Promise<WriterProfile | undefined> {
      const profile = profiles.get(id);
      return profile === undefined ? undefined : createWriterProfile(profile);
    },
    async createIfMissing(profile: WriterProfile): Promise<WriterProfile> {
      const existing = profiles.get(profile.accountId);
      if (existing !== undefined) return createWriterProfile(existing);

      const created = createWriterProfile(profile);
      profiles.set(created.accountId, created);
      return createWriterProfile(created);
    },
    async update(
      profile: WriterProfile,
      expectedVersion: number
    ): Promise<WriterProfile | undefined> {
      const existing = profiles.get(profile.accountId);
      if (existing === undefined || existing.version !== expectedVersion) return undefined;

      const updated = createWriterProfile(profile);
      profiles.set(updated.accountId, updated);
      return createWriterProfile(updated);
    }
  });
}
