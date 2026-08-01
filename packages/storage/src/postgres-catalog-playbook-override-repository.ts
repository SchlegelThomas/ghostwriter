import {
  createCatalogPlaybookOverride,
  instructionContentHash,
  projectId,
  type CatalogAgentId,
  type CatalogPlaybookOverride,
  type CatalogPlaybookOverrideRepository,
  type DeleteCatalogPlaybookOverrideOutcome,
  type ProjectId,
  type UpsertCatalogPlaybookOverrideOutcome
} from "@ghostwriter/core";
import { and, eq } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { projectCatalogPlaybookOverrides } from "./schema.js";

function fromRow(
  row: typeof projectCatalogPlaybookOverrides.$inferSelect
): CatalogPlaybookOverride {
  return createCatalogPlaybookOverride({
    projectId: projectId(row.projectId),
    agentId: row.agentId as CatalogAgentId,
    version: row.version,
    ...(row.doctrine === null ? {} : { doctrine: row.doctrine }),
    ...(row.sections === null
      ? {}
      : {
          sections: row.sections as CatalogPlaybookOverride["sections"]
        }),
    contentHash: instructionContentHash(row.contentHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function toRow(value: CatalogPlaybookOverride) {
  const candidate = createCatalogPlaybookOverride(value);
  return {
    projectId: candidate.projectId,
    agentId: candidate.agentId,
    version: candidate.version,
    doctrine: candidate.doctrine ?? null,
    sections: candidate.sections === undefined ? null : [...candidate.sections],
    contentHash: candidate.contentHash,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

export function createPostgresCatalogPlaybookOverrideRepository(
  db: RepositoryDatabase
): CatalogPlaybookOverrideRepository {
  const repository: CatalogPlaybookOverrideRepository = {
    async get(projectIdValue, agentId) {
      const [row] = await db
        .select()
        .from(projectCatalogPlaybookOverrides)
        .where(
          and(
            eq(projectCatalogPlaybookOverrides.projectId, projectIdValue),
            eq(projectCatalogPlaybookOverrides.agentId, agentId)
          )
        )
        .limit(1);
      return row === undefined ? undefined : fromRow(row);
    },
    async listByProject(projectIdValue: ProjectId) {
      const rows = await db
        .select()
        .from(projectCatalogPlaybookOverrides)
        .where(eq(projectCatalogPlaybookOverrides.projectId, projectIdValue))
        .orderBy(projectCatalogPlaybookOverrides.agentId);
      return Object.freeze(rows.map(fromRow));
    },
    async upsert(
      value,
      expectedVersion
    ): Promise<UpsertCatalogPlaybookOverrideOutcome> {
      const row = toRow(value);
      if (expectedVersion === undefined) {
        const [inserted] = await db
          .insert(projectCatalogPlaybookOverrides)
          .values(row)
          .onConflictDoNothing({
            target: [
              projectCatalogPlaybookOverrides.projectId,
              projectCatalogPlaybookOverrides.agentId
            ]
          })
          .returning();
        return inserted === undefined
          ? { ok: false, reason: "conflict" }
          : { ok: true, override: fromRow(inserted) };
      }
      const [updated] = await db
        .update(projectCatalogPlaybookOverrides)
        .set({
          version: row.version,
          doctrine: row.doctrine,
          sections: row.sections,
          contentHash: row.contentHash,
          updatedAt: row.updatedAt
        })
        .where(
          and(
            eq(projectCatalogPlaybookOverrides.projectId, row.projectId),
            eq(projectCatalogPlaybookOverrides.agentId, row.agentId),
            eq(projectCatalogPlaybookOverrides.version, expectedVersion)
          )
        )
        .returning();
      return updated === undefined
        ? { ok: false, reason: "conflict" }
        : { ok: true, override: fromRow(updated) };
    },
    async delete(
      projectIdValue,
      agentId,
      expectedVersion
    ): Promise<DeleteCatalogPlaybookOverrideOutcome> {
      const [deleted] = await db
        .delete(projectCatalogPlaybookOverrides)
        .where(
          and(
            eq(projectCatalogPlaybookOverrides.projectId, projectIdValue),
            eq(projectCatalogPlaybookOverrides.agentId, agentId),
            eq(projectCatalogPlaybookOverrides.version, expectedVersion)
          )
        )
        .returning();
      if (deleted !== undefined) return { ok: true, deleted: true };
      const [existing] = await db
        .select({ agentId: projectCatalogPlaybookOverrides.agentId })
        .from(projectCatalogPlaybookOverrides)
        .where(
          and(
            eq(projectCatalogPlaybookOverrides.projectId, projectIdValue),
            eq(projectCatalogPlaybookOverrides.agentId, agentId)
          )
        )
        .limit(1);
      return existing === undefined
        ? { ok: true, deleted: false }
        : { ok: false, reason: "conflict" };
    }
  };
  return Object.freeze(repository);
}
