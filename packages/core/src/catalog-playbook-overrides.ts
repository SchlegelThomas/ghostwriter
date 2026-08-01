import { canonicalJsonStringify } from "./agent-canonical-json.js";
import {
  instructionContentHash,
  type AsyncHashPort,
  type InstructionContentHash
} from "./agent-domain.js";
import {
  CATALOG_AGENT_IDS,
  isCatalogAgentId,
  type CatalogAgentId
} from "./catalog-agent-ids.js";
import {
  catalogAgentPlaybook,
  type CatalogAgentPlaybook
} from "./catalog-agent-playbooks.js";
import { ProjectArchivedMutationError } from "./capture-documents.js";
import { DomainValidationError, type ProjectId } from "./domain.js";
import {
  ProjectAccessDeniedError,
  requireProjectOwner,
  type AccountId
} from "./identity.js";
import type { Clock, ProjectRepository } from "./project-repository.js";

export const CATALOG_PLAYBOOK_OVERRIDE_MAX_DOCTRINE_LENGTH = 8_000;
export const CATALOG_PLAYBOOK_OVERRIDE_MAX_SECTION_NOTE_LENGTH = 4_000;

export type CatalogPlaybookOverrideSection = Readonly<{
  heading: string;
  note: string;
}>;

export type CatalogPlaybookOverride = Readonly<{
  projectId: ProjectId;
  agentId: CatalogAgentId;
  version: number;
  doctrine?: string;
  sections?: readonly CatalogPlaybookOverrideSection[];
  contentHash: InstructionContentHash;
  createdAt: string;
  updatedAt: string;
}>;

export type CatalogPlaybookOverrideDraft = Readonly<{
  projectId: ProjectId;
  agentId: CatalogAgentId;
  version: number;
  doctrine?: string;
  sections?: readonly CatalogPlaybookOverrideSection[];
  contentHash: InstructionContentHash;
  createdAt: string;
  updatedAt: string;
}>;

function normalizeDoctrine(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  if (normalized.length > CATALOG_PLAYBOOK_OVERRIDE_MAX_DOCTRINE_LENGTH) {
    throw new DomainValidationError(
      "VALUE_TOO_LONG",
      `Catalog playbook doctrine must be at most ${CATALOG_PLAYBOOK_OVERRIDE_MAX_DOCTRINE_LENGTH} characters.`
    );
  }
  return normalized;
}

function normalizeSections(
  agentId: CatalogAgentId,
  values: readonly CatalogPlaybookOverrideSection[] | undefined
): readonly CatalogPlaybookOverrideSection[] | undefined {
  if (values === undefined || values.length === 0) return undefined;
  const allowed = new Set(catalogAgentPlaybook(agentId).sectionHeadings);
  const seen = new Set<string>();
  const sections = values.map((value) => {
    const heading = value.heading.trim();
    const note = value.note.trim();
    if (!allowed.has(heading)) {
      throw new DomainValidationError(
        "INVALID_AGENT_POLICY",
        `Unknown ${agentId} playbook section heading: ${heading || "(empty)"}.`
      );
    }
    if (seen.has(heading)) {
      throw new DomainValidationError(
        "DUPLICATE_REFERENCE",
        `Catalog playbook section ${heading} was provided more than once.`
      );
    }
    if (note.length === 0) {
      throw new DomainValidationError(
        "EMPTY_VALUE",
        `Catalog playbook section ${heading} must include a note.`
      );
    }
    if (note.length > CATALOG_PLAYBOOK_OVERRIDE_MAX_SECTION_NOTE_LENGTH) {
      throw new DomainValidationError(
        "VALUE_TOO_LONG",
        `Catalog playbook section notes must be at most ${CATALOG_PLAYBOOK_OVERRIDE_MAX_SECTION_NOTE_LENGTH} characters.`
      );
    }
    seen.add(heading);
    return Object.freeze({ heading, note });
  });
  return Object.freeze(sections);
}

export function createCatalogPlaybookOverride(
  input: CatalogPlaybookOverrideDraft
): CatalogPlaybookOverride {
  if (!isCatalogAgentId(String(input.agentId))) {
    throw new DomainValidationError("INVALID_AGENT_POLICY", "Catalog agent id is invalid.");
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new DomainValidationError("INVALID_VERSION", "Override version must be positive.");
  }
  const doctrine = normalizeDoctrine(input.doctrine);
  const sections = normalizeSections(input.agentId, input.sections);
  if (doctrine === undefined && sections === undefined) {
    throw new DomainValidationError(
      "EMPTY_VALUE",
      "A catalog playbook override must include doctrine or section notes."
    );
  }
  return Object.freeze({
    projectId: input.projectId,
    agentId: input.agentId,
    version: input.version,
    ...(doctrine === undefined ? {} : { doctrine }),
    ...(sections === undefined ? {} : { sections }),
    contentHash: input.contentHash,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  });
}

export function mergeCatalogPlaybook(
  base: CatalogAgentPlaybook,
  override: CatalogPlaybookOverride | undefined
): CatalogAgentPlaybook {
  if (override === undefined) return base;
  if (override.agentId !== base.agentId) {
    throw new DomainValidationError(
      "INVALID_AGENT_POLICY",
      "Catalog playbook override does not match the built-in agent."
    );
  }
  const notes = new Map(override.sections?.map((section) => [section.heading, section.note]));
  const sections = Object.freeze(
    base.sections.map((section) =>
      Object.freeze({
        heading: section.heading,
        note: notes.get(section.heading) ?? section.note
      })
    )
  );
  return Object.freeze({
    ...base,
    doctrine: override.doctrine ?? base.doctrine,
    sections,
    sectionHeadings: base.sectionHeadings
  });
}

export type UpsertCatalogPlaybookOverrideOutcome =
  | Readonly<{ ok: true; override: CatalogPlaybookOverride }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export type DeleteCatalogPlaybookOverrideOutcome =
  | Readonly<{ ok: true; deleted: boolean }>
  | Readonly<{ ok: false; reason: "conflict" }>;

export interface CatalogPlaybookOverrideRepository {
  get(
    projectId: ProjectId,
    agentId: CatalogAgentId
  ): Promise<CatalogPlaybookOverride | undefined>;
  listByProject(projectId: ProjectId): Promise<readonly CatalogPlaybookOverride[]>;
  upsert(
    override: CatalogPlaybookOverride,
    expectedVersion: number | undefined
  ): Promise<UpsertCatalogPlaybookOverrideOutcome>;
  delete(
    projectId: ProjectId,
    agentId: CatalogAgentId,
    expectedVersion: number
  ): Promise<DeleteCatalogPlaybookOverrideOutcome>;
}

export class CatalogPlaybookOverrideNotFoundError extends Error {
  constructor() {
    super("The requested catalog playbook could not be found.");
    this.name = "CatalogPlaybookOverrideNotFoundError";
  }
}

export class CatalogPlaybookOverrideConflictError extends Error {
  constructor() {
    super("The catalog playbook changed since it was loaded.");
    this.name = "CatalogPlaybookOverrideConflictError";
  }
}

export type CatalogPlaybookOverrideServices = Readonly<{
  get(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    agentId: CatalogAgentId;
  }>): Promise<CatalogPlaybookOverride | undefined>;
  list(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
  }>): Promise<readonly CatalogPlaybookOverride[]>;
  upsert(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    agentId: CatalogAgentId;
    doctrine?: string;
    sections?: readonly CatalogPlaybookOverrideSection[];
    expectedVersion?: number;
  }>): Promise<CatalogPlaybookOverride>;
  reset(input: Readonly<{
    accountId: AccountId;
    projectId: ProjectId;
    agentId: CatalogAgentId;
  }>): Promise<boolean>;
}>;

export type CatalogPlaybookOverrideServiceDependencies = Readonly<{
  projects: ProjectRepository;
  overrides: CatalogPlaybookOverrideRepository;
  hashPort: AsyncHashPort;
  clock: Clock;
}>;

async function requireOwnedProject(
  dependencies: CatalogPlaybookOverrideServiceDependencies,
  accountId: AccountId,
  projectId: ProjectId,
  mutation: boolean
): Promise<void> {
  try {
    requireProjectOwner(
      projectId,
      await dependencies.projects.getProjectMembership(projectId, accountId)
    );
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      throw new CatalogPlaybookOverrideNotFoundError();
    }
    throw error;
  }
  const project = await dependencies.projects.getProject(projectId);
  if (project === undefined) throw new CatalogPlaybookOverrideNotFoundError();
  if (mutation && project.archivedAt !== undefined) {
    throw new ProjectArchivedMutationError();
  }
}

export function createCatalogPlaybookOverrideServices(
  dependencies: CatalogPlaybookOverrideServiceDependencies
): CatalogPlaybookOverrideServices {
  return Object.freeze({
    async get(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId, false);
      return dependencies.overrides.get(input.projectId, input.agentId);
    },
    async list(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId, false);
      return dependencies.overrides.listByProject(input.projectId);
    },
    async upsert(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId, true);
      const existing = await dependencies.overrides.get(input.projectId, input.agentId);
      const doctrine = normalizeDoctrine(input.doctrine);
      const sections = normalizeSections(input.agentId, input.sections);
      if (doctrine === undefined && sections === undefined) {
        throw new DomainValidationError(
          "EMPTY_VALUE",
          "A catalog playbook override must include doctrine or section notes."
        );
      }
      const now = dependencies.clock.now();
      const digest = await dependencies.hashPort.digestSha256Hex(
        canonicalJsonStringify({
          agentId: input.agentId,
          ...(doctrine === undefined ? {} : { doctrine }),
          ...(sections === undefined ? {} : { sections })
        })
      );
      const override = createCatalogPlaybookOverride({
        projectId: input.projectId,
        agentId: input.agentId,
        version: (existing?.version ?? 0) + 1,
        ...(doctrine === undefined ? {} : { doctrine }),
        ...(sections === undefined ? {} : { sections }),
        contentHash: instructionContentHash(digest),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      const outcome = await dependencies.overrides.upsert(
        override,
        existing === undefined ? undefined : input.expectedVersion
      );
      if (!outcome.ok) throw new CatalogPlaybookOverrideConflictError();
      return outcome.override;
    },
    async reset(input) {
      await requireOwnedProject(dependencies, input.accountId, input.projectId, true);
      const existing = await dependencies.overrides.get(input.projectId, input.agentId);
      if (existing === undefined) return false;
      const outcome = await dependencies.overrides.delete(
        input.projectId,
        input.agentId,
        existing.version
      );
      if (!outcome.ok) throw new CatalogPlaybookOverrideConflictError();
      return outcome.deleted;
    }
  });
}

export function catalogPlaybookSummaries(
  overrides: readonly CatalogPlaybookOverride[]
) {
  const overridden = new Set(overrides.map((override) => override.agentId));
  return CATALOG_AGENT_IDS.map((agentId) => {
    const builtIn = catalogAgentPlaybook(agentId);
    return Object.freeze({
      agentId,
      label: builtIn.label,
      stage: builtIn.stage,
      builtInVersion: builtIn.version,
      overridden: overridden.has(agentId),
      doctrinePreview: mergeCatalogPlaybook(
        builtIn,
        overrides.find((override) => override.agentId === agentId)
      ).doctrine.slice(0, 240)
    });
  });
}
