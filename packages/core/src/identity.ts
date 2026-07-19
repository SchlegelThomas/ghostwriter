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

function optionalText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > max) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Profile field must be at most ${max} characters.`
    );
  }
  return normalized;
}

/** Contact and rights details a writer needs when submitting work for publication. */
export type WriterPublishingDetails = Readonly<{
  legalName?: string;
  contactEmail?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  bio?: string;
  agentName?: string;
  agencyName?: string;
}>;

export function createWriterPublishingDetails(
  details: WriterPublishingDetails | undefined
): WriterPublishingDetails | undefined {
  if (details === undefined) return undefined;
  const legalName = optionalText(details.legalName, 120);
  const contactEmail = optionalText(details.contactEmail, 200);
  const phone = optionalText(details.phone, 40);
  const addressLine1 = optionalText(details.addressLine1, 200);
  const addressLine2 = optionalText(details.addressLine2, 200);
  const city = optionalText(details.city, 100);
  const region = optionalText(details.region, 100);
  const postalCode = optionalText(details.postalCode, 40);
  const country = optionalText(details.country, 100);
  const website = optionalText(details.website, 300);
  const bio = optionalText(details.bio, 4_000);
  const agentName = optionalText(details.agentName, 120);
  const agencyName = optionalText(details.agencyName, 160);
  const next: WriterPublishingDetails = Object.freeze({
    ...(legalName === undefined ? {} : { legalName }),
    ...(contactEmail === undefined ? {} : { contactEmail }),
    ...(phone === undefined ? {} : { phone }),
    ...(addressLine1 === undefined ? {} : { addressLine1 }),
    ...(addressLine2 === undefined ? {} : { addressLine2 }),
    ...(city === undefined ? {} : { city }),
    ...(region === undefined ? {} : { region }),
    ...(postalCode === undefined ? {} : { postalCode }),
    ...(country === undefined ? {} : { country }),
    ...(website === undefined ? {} : { website }),
    ...(bio === undefined ? {} : { bio }),
    ...(agentName === undefined ? {} : { agentName }),
    ...(agencyName === undefined ? {} : { agencyName })
  });
  return Object.keys(next).length === 0 ? undefined : next;
}

export type WriterProfile = Readonly<{
  accountId: AccountId;
  displayName: string;
  publishing?: WriterPublishingDetails;
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

  const publishing = createWriterPublishingDetails(profile.publishing);
  return Object.freeze({
    accountId: profile.accountId,
    displayName: requireDisplayName(profile.displayName),
    ...(publishing === undefined ? {} : { publishing }),
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
    publishing?: WriterPublishingDetails | null;
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

      const publishing =
        input.publishing === null
          ? undefined
          : input.publishing === undefined
            ? existing.publishing
            : createWriterPublishingDetails(input.publishing);

      const updated = createWriterProfile({
        accountId: existing.accountId,
        displayName: input.displayName,
        ...(publishing === undefined ? {} : { publishing }),
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: dependencies.clock.now()
      });
      const stored = await dependencies.profiles.update(updated, input.expectedVersion);

      if (stored === undefined) throw new ProfileConflictError();
      return stored;
    }
  });
}
