import { DomainValidationError, type ProjectId } from "./domain.js";
import type { Clock } from "./project-repository.js";

type BrandedId<Name extends string> = string & { readonly __brand: Name };

export type AccountId = BrandedId<"AccountId">;

export function accountId(value: string): AccountId {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", "Account ID must not be empty.");
  }
  return normalized as AccountId;
}

export type ProjectRole = "owner";

export type ProjectMembership = Readonly<{
  projectId: ProjectId;
  accountId: AccountId;
  role: ProjectRole;
  createdAt: string;
}>;

export function createProjectMembership(
  membership: ProjectMembership
): ProjectMembership {
  return Object.freeze({
    projectId: membership.projectId,
    accountId: membership.accountId,
    role: membership.role,
    createdAt: membership.createdAt
  });
}

export class ProjectAccessDeniedError extends Error {
  readonly projectId: ProjectId;

  constructor(projectId: ProjectId) {
    super("The authenticated writer cannot access this project.");
    this.name = "ProjectAccessDeniedError";
    this.projectId = projectId;
  }
}

export function requireProjectOwner(
  projectId: ProjectId,
  membership: ProjectMembership | undefined
): ProjectMembership {
  if (membership === undefined || membership.role !== "owner") {
    throw new ProjectAccessDeniedError(projectId);
  }
  return membership;
}

function requireDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError("EMPTY_VALUE", "Writer display name must not be empty.");
  }
  return normalized;
}

export type WriterProfile = Readonly<{
  accountId: AccountId;
  displayName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export function createWriterProfile(profile: WriterProfile): WriterProfile {
  if (!Number.isSafeInteger(profile.version) || profile.version < 1) {
    throw new DomainValidationError(
      "INVALID_VERSION",
      "Writer profile version must be a positive integer."
    );
  }

  return Object.freeze({
    accountId: profile.accountId,
    displayName: requireDisplayName(profile.displayName),
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  });
}

export interface WriterProfileRepository {
  get(accountId: AccountId): Promise<WriterProfile | undefined>;
  createIfMissing(profile: WriterProfile): Promise<WriterProfile>;
  update(
    profile: WriterProfile,
    expectedVersion: number
  ): Promise<WriterProfile | undefined>;
}

export class ProfileConflictError extends Error {
  constructor() {
    super("The writer profile changed since it was loaded.");
    this.name = "ProfileConflictError";
  }
}

export type IdentityServices = Readonly<{
  ensureWriterProfile(input: Readonly<{
    accountId: AccountId;
    providerDisplayName: string;
  }>): Promise<WriterProfile>;
  updateWriterProfile(input: Readonly<{
    accountId: AccountId;
    displayName: string;
    expectedVersion: number;
  }>): Promise<WriterProfile>;
}>;

export function createIdentityServices(dependencies: {
  profiles: WriterProfileRepository;
  clock: Clock;
}): IdentityServices {
  return Object.freeze({
    async ensureWriterProfile(input): Promise<WriterProfile> {
      const existing = await dependencies.profiles.get(input.accountId);
      if (existing !== undefined) return existing;

      const now = dependencies.clock.now();
      return dependencies.profiles.createIfMissing(
        createWriterProfile({
          accountId: input.accountId,
          displayName: input.providerDisplayName,
          version: 1,
          createdAt: now,
          updatedAt: now
        })
      );
    },
    async updateWriterProfile(input): Promise<WriterProfile> {
      const existing = await dependencies.profiles.get(input.accountId);
      if (existing === undefined) {
        throw new ProfileConflictError();
      }

      const updated = createWriterProfile({
        ...existing,
        displayName: input.displayName,
        version: existing.version + 1,
        updatedAt: dependencies.clock.now()
      });
      const stored = await dependencies.profiles.update(updated, input.expectedVersion);

      if (stored === undefined) throw new ProfileConflictError();
      return stored;
    }
  });
}
