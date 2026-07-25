import {
  createAccountAiCollaborationProfile,
  createProjectAgentInstructions,
  createProjectPlaybook,
  instructionContentHash,
  normalizeAgentFoundationListLimit,
  playbookId,
  projectId,
  type AccountAiCollaborationProfile,
  type AccountAiCollaborationProfileRepository,
  type AgentContextClass,
  type ProjectAgentInstructions,
  type ProjectAgentInstructionsRepository,
  type ProjectPlaybook,
  type ProjectPlaybookRepository,
  type AgentGuidanceListOptions,
  type UpsertAccountAiCollaborationProfileOutcome,
  type UpsertProjectAgentInstructionsOutcome,
  type UpsertProjectPlaybookOutcome,
  type PlaybookId,
  type ProjectId,
  type AccountId
} from "@ghostwriter/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  aiCollaborationProfiles,
  projectAgentInstructions,
  projectPlaybooks
} from "./schema.js";

function profileFromRow(
  row: typeof aiCollaborationProfiles.$inferSelect
): AccountAiCollaborationProfile {
  if (row.setupSkipped) {
    return createAccountAiCollaborationProfile({
      version: row.version,
      setupSkipped: true,
      updatedAt: row.updatedAt
    });
  }
  return createAccountAiCollaborationProfile({
    version: row.version,
    setupSkipped: false,
    posture: row.posture as AccountAiCollaborationProfile["posture"],
    updatedAt: row.updatedAt,
    ...(row.boundaries === null ? {} : { boundaries: row.boundaries })
  });
}

function instructionsFromRow(
  row: typeof projectAgentInstructions.$inferSelect
): ProjectAgentInstructions {
  return createProjectAgentInstructions({
    projectId: projectId(row.projectId),
    version: row.version,
    body: row.body,
    contentHash: instructionContentHash(row.contentHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function parseAllowedContextClasses(value: unknown): readonly AgentContextClass[] {
  if (!Array.isArray(value)) {
    throw new Error("Stored playbook context classes are invalid.");
  }
  return value as readonly AgentContextClass[];
}

function playbookFromRow(row: typeof projectPlaybooks.$inferSelect): ProjectPlaybook {
  return createProjectPlaybook({
    projectId: projectId(row.projectId),
    id: playbookId(row.id),
    version: row.version,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger as ProjectPlaybook["trigger"],
    allowedContextClasses: parseAllowedContextClasses(row.allowedContextClasses),
    outputSchemaId: row.outputSchemaId as ProjectPlaybook["outputSchemaId"],
    guidance: row.guidance,
    guidanceHash: instructionContentHash(row.guidanceHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt })
  });
}

function playbookToRow(playbook: ProjectPlaybook) {
  const candidate = createProjectPlaybook(playbook);
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    version: candidate.version,
    name: candidate.name,
    enabled: candidate.enabled,
    trigger: candidate.trigger,
    allowedContextClasses: [...candidate.allowedContextClasses],
    outputSchemaId: candidate.outputSchemaId,
    guidance: candidate.guidance,
    guidanceHash: candidate.guidanceHash,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    archivedAt: candidate.archivedAt ?? null
  };
}

export function createPostgresAccountAiCollaborationProfileRepository(
  db: RepositoryDatabase
): AccountAiCollaborationProfileRepository {
  return Object.freeze({
    async get(id: AccountId): Promise<AccountAiCollaborationProfile | undefined> {
      const [row] = await db
        .select()
        .from(aiCollaborationProfiles)
        .where(eq(aiCollaborationProfiles.accountId, id))
        .limit(1);
      return row === undefined ? undefined : profileFromRow(row);
    },

    async upsert(
      accountIdValue: AccountId,
      profile: AccountAiCollaborationProfile,
      expectedVersion: number | undefined
    ): Promise<UpsertAccountAiCollaborationProfileOutcome> {
      const candidate = createAccountAiCollaborationProfile(profile);
      const row = {
        accountId: accountIdValue,
        version: candidate.version,
        setupSkipped: candidate.setupSkipped,
        posture: candidate.posture ?? null,
        boundaries: candidate.boundaries ?? null,
        updatedAt: candidate.updatedAt
      };

      if (expectedVersion === undefined) {
        const [inserted] = await db
          .insert(aiCollaborationProfiles)
          .values(row)
          .onConflictDoNothing({ target: aiCollaborationProfiles.accountId })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "conflict" };
        }
        return { ok: true, profile: profileFromRow(inserted) };
      }

      const [updated] = await db
        .update(aiCollaborationProfiles)
        .set({
          version: row.version,
          setupSkipped: row.setupSkipped,
          posture: row.posture,
          boundaries: row.boundaries,
          updatedAt: row.updatedAt
        })
        .where(
          and(
            eq(aiCollaborationProfiles.accountId, accountIdValue),
            eq(aiCollaborationProfiles.version, expectedVersion)
          )
        )
        .returning();
      if (updated === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, profile: profileFromRow(updated) };
    }
  });
}

export function createPostgresProjectAgentInstructionsRepository(
  db: RepositoryDatabase
): ProjectAgentInstructionsRepository {
  return Object.freeze({
    async get(id: ProjectId): Promise<ProjectAgentInstructions | undefined> {
      const [row] = await db
        .select()
        .from(projectAgentInstructions)
        .where(eq(projectAgentInstructions.projectId, id))
        .limit(1);
      return row === undefined ? undefined : instructionsFromRow(row);
    },

    async upsert(
      instructions: ProjectAgentInstructions,
      expectedVersion: number | undefined
    ): Promise<UpsertProjectAgentInstructionsOutcome> {
      const candidate = createProjectAgentInstructions(instructions);
      const row = {
        projectId: candidate.projectId,
        version: candidate.version,
        body: candidate.body,
        contentHash: candidate.contentHash,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt
      };

      if (expectedVersion === undefined) {
        const [inserted] = await db
          .insert(projectAgentInstructions)
          .values(row)
          .onConflictDoNothing({ target: projectAgentInstructions.projectId })
          .returning();
        if (inserted === undefined) {
          return { ok: false, reason: "conflict" };
        }
        return { ok: true, instructions: instructionsFromRow(inserted) };
      }

      const [updated] = await db
        .update(projectAgentInstructions)
        .set({
          version: row.version,
          body: row.body,
          contentHash: row.contentHash,
          updatedAt: row.updatedAt
        })
        .where(
          and(
            eq(projectAgentInstructions.projectId, candidate.projectId),
            eq(projectAgentInstructions.version, expectedVersion)
          )
        )
        .returning();
      if (updated === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, instructions: instructionsFromRow(updated) };
    }
  });
}

export function createPostgresProjectPlaybookRepository(
  db: RepositoryDatabase
): ProjectPlaybookRepository {
  return Object.freeze({
    async get(playbookIdValue: PlaybookId): Promise<ProjectPlaybook | undefined> {
      const [row] = await db
        .select()
        .from(projectPlaybooks)
        .where(eq(projectPlaybooks.id, playbookIdValue))
        .limit(1);
      return row === undefined ? undefined : playbookFromRow(row);
    },

    async listByProject(
      projectIdValue: ProjectId,
      options: AgentGuidanceListOptions = {}
    ): Promise<readonly ProjectPlaybook[]> {
      const limit = normalizeAgentFoundationListLimit(options.limit);
      const includeArchived = options.includeArchived ?? false;
      const rows = await db
        .select()
        .from(projectPlaybooks)
        .where(
          and(
            eq(projectPlaybooks.projectId, projectIdValue),
            includeArchived ? undefined : isNull(projectPlaybooks.archivedAt)
          )
        )
        .orderBy(desc(projectPlaybooks.updatedAt), desc(projectPlaybooks.id))
        .limit(limit);
      return Object.freeze(rows.map(playbookFromRow));
    },

    async create(playbook: ProjectPlaybook): Promise<UpsertProjectPlaybookOutcome> {
      const row = playbookToRow(playbook);
      const [inserted] = await db
        .insert(projectPlaybooks)
        .values(row)
        .onConflictDoNothing({ target: projectPlaybooks.id })
        .returning();
      if (inserted === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, playbook: playbookFromRow(inserted) };
    },

    async update(
      playbook: ProjectPlaybook,
      expectedVersion: number
    ): Promise<UpsertProjectPlaybookOutcome> {
      const row = playbookToRow(playbook);
      const [updated] = await db
        .update(projectPlaybooks)
        .set({
          projectId: row.projectId,
          version: row.version,
          name: row.name,
          enabled: row.enabled,
          trigger: row.trigger,
          allowedContextClasses: row.allowedContextClasses,
          outputSchemaId: row.outputSchemaId,
          guidance: row.guidance,
          guidanceHash: row.guidanceHash,
          updatedAt: row.updatedAt,
          archivedAt: row.archivedAt
        })
        .where(
          and(
            eq(projectPlaybooks.id, row.id),
            eq(projectPlaybooks.version, expectedVersion)
          )
        )
        .returning();
      if (updated !== undefined) {
        return { ok: true, playbook: playbookFromRow(updated) };
      }
      const [existing] = await db
        .select({ id: projectPlaybooks.id })
        .from(projectPlaybooks)
        .where(eq(projectPlaybooks.id, row.id))
        .limit(1);
      return existing === undefined
        ? { ok: false, reason: "not-found" }
        : { ok: false, reason: "conflict" };
    }
  });
}
