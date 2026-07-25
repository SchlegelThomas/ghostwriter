import {
  accountId,
  createMcpGrantRecord,
  mcpGrantId,
  mcpGrantTokenHash,
  projectId,
  type McpGrantId,
  type McpGrantRecord,
  type McpGrantRepository,
  type McpGrantTokenHash,
  type McpGrantToolName,
  type ProjectId,
  type InsertMcpGrantOutcome,
  type RevokeMcpGrantOutcome,
  type CaptureId
} from "@ghostwriter/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { mcpGrants } from "./schema.js";

function grantFromRow(row: typeof mcpGrants.$inferSelect): McpGrantRecord {
  return createMcpGrantRecord({
    id: mcpGrantId(row.id),
    accountId: accountId(row.accountId),
    projectId: projectId(row.projectId),
    captureIds: row.captureIds as readonly CaptureId[],
    tools: row.tools as readonly McpGrantToolName[],
    tokenHash: mcpGrantTokenHash(row.tokenHash),
    tokenHint: row.tokenHint,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt })
  });
}

function grantToRow(grant: McpGrantRecord) {
  const candidate = createMcpGrantRecord(grant);
  return {
    id: candidate.id,
    accountId: candidate.accountId,
    projectId: candidate.projectId,
    captureIds: [...candidate.captureIds],
    tools: [...candidate.tools],
    tokenHash: candidate.tokenHash,
    tokenHint: candidate.tokenHint,
    expiresAt: candidate.expiresAt,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    revokedAt: candidate.revokedAt ?? null
  };
}

export function createPostgresMcpGrantRepository(
  db: RepositoryDatabase
): McpGrantRepository {
  return Object.freeze({
    async getById(id: McpGrantId): Promise<McpGrantRecord | undefined> {
      const [row] = await db
        .select()
        .from(mcpGrants)
        .where(eq(mcpGrants.id, id))
        .limit(1);
      return row === undefined ? undefined : grantFromRow(row);
    },

    async getByTokenHash(
      tokenHash: McpGrantTokenHash
    ): Promise<McpGrantRecord | undefined> {
      const [row] = await db
        .select()
        .from(mcpGrants)
        .where(eq(mcpGrants.tokenHash, tokenHash))
        .limit(1);
      return row === undefined ? undefined : grantFromRow(row);
    },

    async listByProject(scopedProjectId: ProjectId): Promise<readonly McpGrantRecord[]> {
      const rows = await db
        .select()
        .from(mcpGrants)
        .where(eq(mcpGrants.projectId, scopedProjectId))
        .orderBy(desc(mcpGrants.createdAt), desc(mcpGrants.id));
      return Object.freeze(rows.map(grantFromRow));
    },

    async insert(grant: McpGrantRecord): Promise<InsertMcpGrantOutcome> {
      const row = grantToRow(grant);
      const [inserted] = await db
        .insert(mcpGrants)
        .values(row)
        .onConflictDoNothing({ target: mcpGrants.id })
        .returning();
      if (inserted === undefined) {
        return { ok: false, reason: "conflict" };
      }
      return { ok: true, grant: grantFromRow(inserted) };
    },

    async revoke(input: Readonly<{
      id: McpGrantId;
      projectId: ProjectId;
      revokedAt: string;
      updatedAt: string;
    }>): Promise<RevokeMcpGrantOutcome> {
      const [updated] = await db
        .update(mcpGrants)
        .set({
          revokedAt: input.revokedAt,
          updatedAt: input.updatedAt
        })
        .where(
          and(
            eq(mcpGrants.id, input.id),
            eq(mcpGrants.projectId, input.projectId),
            isNull(mcpGrants.revokedAt)
          )
        )
        .returning();
      if (updated === undefined) {
        const [existing] = await db
          .select({ id: mcpGrants.id, revokedAt: mcpGrants.revokedAt })
          .from(mcpGrants)
          .where(
            and(eq(mcpGrants.id, input.id), eq(mcpGrants.projectId, input.projectId))
          )
          .limit(1);
        if (existing === undefined) {
          return { ok: false, reason: "not-found" };
        }
        return { ok: false, reason: "already-revoked" };
      }
      return { ok: true, grant: grantFromRow(updated) };
    }
  });
}
