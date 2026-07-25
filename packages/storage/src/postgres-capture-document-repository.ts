import {
  accountId,
  captureContentHash,
  captureId,
  captureRevisionId,
  captureSummaryFromHead,
  createCaptureDocumentHead,
  createCaptureRevision,
  DomainValidationError,
  isUntouchedEmptyGenesisCapture,
  projectId,
  sceneId,
  type CaptureDocumentHead,
  type CaptureDocumentRepository,
  type CaptureRevision,
  type CaptureRevisionOrigin,
  type CaptureRevisionReason,
  type CaptureSummary,
  type CaptureId,
  type CaptureRevisionId,
  type ProjectId,
  type InitializeCaptureDocumentInput,
  type IntegrateCaptureDocumentInput,
  type IntegrateCaptureDocumentOutcome,
  type ListCapturesOptions,
  type SaveWorkingCaptureDocumentInput,
  type SaveWorkingCaptureDocumentOutcome,
  type SetCaptureArchivedInput,
  type SetCaptureArchivedOutcome
} from "@ghostwriter/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import { captureRevisions, captures, projects } from "./schema.js";

function assertGenesis(input: InitializeCaptureDocumentInput): void {
  const { head, genesisRevision } = input;
  if (
    genesisRevision.reason !== "genesis" ||
    genesisRevision.parentRevisionId !== undefined ||
    head.genesisRevisionId !== genesisRevision.id ||
    head.captureId !== genesisRevision.captureId ||
    head.projectId !== genesisRevision.projectId ||
    head.contentHash !== genesisRevision.contentHash ||
    head.status !== "draft" ||
    head.archivedAt !== undefined
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A capture document must initialize from its matching genesis revision."
    );
  }
}

function headFromRow(row: typeof captures.$inferSelect): CaptureDocumentHead {
  const document = row.document as CaptureDocumentHead["document"];
  if (document.schemaVersion !== row.schemaVersion) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Stored capture document schema versions do not match."
    );
  }
  return createCaptureDocumentHead({
    captureId: captureId(row.captureId),
    projectId: projectId(row.projectId),
    status: row.status as CaptureDocumentHead["status"],
    sourceModality: row.sourceModality as CaptureDocumentHead["sourceModality"],
    workingVersion: row.workingVersion,
    document,
    contentHash: captureContentHash(row.contentHash),
    genesisRevisionId: captureRevisionId(row.genesisRevisionId),
    authorAccountId: accountId(row.authorAccountId),
    updatedByAccountId: accountId(row.updatedByAccountId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
    ...(row.integrationRevisionId === null
      ? {}
      : { integrationRevisionId: captureRevisionId(row.integrationRevisionId) }),
    ...(row.integratedSceneId === null
      ? {}
      : { integratedSceneId: sceneId(row.integratedSceneId) }),
    ...(row.integratedAt === null ? {} : { integratedAt: row.integratedAt }),
    ...(row.integratedByAccountId === null
      ? {}
      : { integratedByAccountId: accountId(row.integratedByAccountId) })
  });
}

function revisionFromRow(
  row: typeof captureRevisions.$inferSelect
): CaptureRevision {
  const document = row.document as CaptureRevision["document"];
  if (document.schemaVersion !== row.schemaVersion) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Stored capture revision schema versions do not match."
    );
  }
  return createCaptureRevision({
    id: captureRevisionId(row.id),
    captureId: captureId(row.captureId),
    projectId: projectId(row.projectId),
    ...(row.parentRevisionId === null
      ? {}
      : { parentRevisionId: captureRevisionId(row.parentRevisionId) }),
    document,
    contentHash: captureContentHash(row.contentHash),
    actorAccountId: accountId(row.actorAccountId),
    origin: row.origin as CaptureRevisionOrigin,
    reason: row.reason as CaptureRevisionReason,
    createdAt: row.createdAt
  });
}

function shouldListCapture(
  head: CaptureDocumentHead,
  genesis: CaptureRevision,
  options: ListCapturesOptions
): boolean {
  if (isUntouchedEmptyGenesisCapture(head, genesis)) {
    return false;
  }
  if (head.status === "archived" && options.includeArchived !== true) {
    return false;
  }
  return true;
}

async function queryHead(
  db: RepositoryDatabase,
  id: ReturnType<typeof captureId>
): Promise<CaptureDocumentHead | undefined> {
  const [row] = await db
    .select()
    .from(captures)
    .where(eq(captures.captureId, id))
    .limit(1);
  return row === undefined ? undefined : headFromRow(row);
}

async function queryRevision(
  db: RepositoryDatabase,
  id: ReturnType<typeof captureRevisionId>
): Promise<CaptureRevision | undefined> {
  const [row] = await db
    .select()
    .from(captureRevisions)
    .where(eq(captureRevisions.id, id))
    .limit(1);
  return row === undefined ? undefined : revisionFromRow(row);
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== undefined && current !== null;
    depth += 1
  ) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return undefined;
}

function mapInitializeError(error: unknown): never {
  if (error instanceof DomainValidationError) throw error;
  const code = postgresErrorCode(error);
  if (code === "23503") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The capture document references a record that does not exist."
    );
  }
  if (code === "23505") {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The capture document revision ID already exists."
    );
  }
  throw error;
}

async function resolveSaveConflict(
  db: RepositoryDatabase,
  input: SaveWorkingCaptureDocumentInput
): Promise<SaveWorkingCaptureDocumentOutcome> {
  const current = await queryHead(db, input.captureId);
  if (
    current === undefined ||
    current.projectId !== input.projectId ||
    current.workingVersion !== input.expectedWorkingVersion
  ) {
    return { ok: false, reason: "working-version-conflict" };
  }
  if (current.status === "integrated") {
    return { ok: false, reason: "capture-integrated" };
  }
  if (current.status === "archived") {
    return { ok: false, reason: "capture-archived" };
  }
  return { ok: false, reason: "working-version-conflict" };
}

function assertIntegrationRevision(
  current: CaptureDocumentHead,
  input: IntegrateCaptureDocumentInput
): void {
  if (
    input.integrationRevision.captureId !== current.captureId ||
    input.integrationRevision.projectId !== current.projectId ||
    input.integrationRevision.reason !== "integration" ||
    input.integrationRevision.parentRevisionId !== current.genesisRevisionId ||
    input.integrationRevision.contentHash !== current.contentHash
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Capture integration revision must match the promoted head."
    );
  }
}

async function integrateInTransaction(
  db: RepositoryDatabase,
  input: IntegrateCaptureDocumentInput
): Promise<IntegrateCaptureDocumentOutcome> {
  const [locked] = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.captureId, input.captureId),
        eq(captures.projectId, input.projectId)
      )
    )
    .for("update")
    .limit(1);
  if (locked === undefined) {
    return { ok: false, reason: "not-found" };
  }
  const current = headFromRow(locked);
  if (current.workingVersion !== input.expectedWorkingVersion) {
    return { ok: false, reason: "working-version-conflict" };
  }
  if (current.contentHash !== input.expectedContentHash) {
    return { ok: false, reason: "content-hash-mismatch" };
  }
  if (current.status === "integrated") {
    return { ok: false, reason: "capture-integrated" };
  }
  if (current.status === "archived") {
    return { ok: false, reason: "capture-archived" };
  }

  const existingRevision = await queryRevision(
    db,
    input.integrationRevision.id
  );
  if (existingRevision !== undefined) {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The capture document revision ID already exists."
    );
  }
  assertIntegrationRevision(current, input);

  await db.insert(captureRevisions).values({
    id: input.integrationRevision.id,
    captureId: input.integrationRevision.captureId,
    projectId: input.integrationRevision.projectId,
    parentRevisionId: input.integrationRevision.parentRevisionId ?? null,
    schemaVersion: input.integrationRevision.document.schemaVersion,
    document: input.integrationRevision.document,
    contentHash: input.integrationRevision.contentHash,
    actorAccountId: input.integrationRevision.actorAccountId,
    origin: input.integrationRevision.origin,
    reason: input.integrationRevision.reason,
    createdAt: input.integrationRevision.createdAt
  });

  const [updated] = await db
    .update(captures)
    .set({
      status: "integrated",
      integrationRevisionId: input.integrationRevision.id,
      integratedSceneId: input.integratedSceneId,
      integratedAt: input.now,
      integratedByAccountId: input.actorAccountId,
      updatedByAccountId: input.actorAccountId,
      updatedAt: input.now
    })
    .where(
      and(
        eq(captures.captureId, input.captureId),
        eq(captures.projectId, input.projectId),
        eq(captures.workingVersion, input.expectedWorkingVersion),
        eq(captures.contentHash, input.expectedContentHash),
        inArray(captures.status, ["draft", "ready"])
      )
    )
    .returning();
  if (updated === undefined) {
    throw new Error(
      "Capture integration update failed after revision insert within the same transaction."
    );
  }
  const revision = createCaptureRevision(input.integrationRevision);
  return {
    ok: true,
    head: headFromRow(updated),
    revision: createCaptureRevision(revision)
  };
}

export function createPostgresCaptureDocumentRepository(
  db: RepositoryDatabase
): CaptureDocumentRepository {
  return Object.freeze({
    get(id: CaptureId) {
      return queryHead(db, id);
    },
    getRevision(id: CaptureRevisionId) {
      return queryRevision(db, id);
    },
    async list(
      projectIdValue: ProjectId,
      options: ListCapturesOptions = {}
    ): Promise<readonly CaptureSummary[]> {
      const rows = await db
        .select()
        .from(captures)
        .where(eq(captures.projectId, projectIdValue));
      if (rows.length === 0) return [];

      const genesisIds = rows.map((row) => row.genesisRevisionId);
      const revisionRows = await db
        .select()
        .from(captureRevisions)
        .where(inArray(captureRevisions.id, genesisIds));
      const genesisById = new Map(
        revisionRows.map((row) => [row.id, revisionFromRow(row)])
      );

      const summaries: CaptureSummary[] = [];
      for (const row of rows) {
        const head = headFromRow(row);
        const genesis = genesisById.get(row.genesisRevisionId);
        if (genesis === undefined) continue;
        if (!shouldListCapture(head, genesis, options)) continue;
        summaries.push(captureSummaryFromHead(head));
      }
      return summaries.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.captureId.localeCompare(left.captureId)
      );
    },
    async initialize(
      input: InitializeCaptureDocumentInput
    ): Promise<CaptureDocumentHead> {
      assertGenesis(input);
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          const existing = await queryHead(exec, input.head.captureId);
          if (existing !== undefined) return existing;

          const [project] = await exec
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, input.head.projectId))
            .limit(1);
          if (project === undefined) {
            throw new DomainValidationError(
              "UNKNOWN_REFERENCE",
              "The capture document cannot initialize an unknown project."
            );
          }

          try {
            await exec.insert(captureRevisions).values({
              id: input.genesisRevision.id,
              captureId: input.genesisRevision.captureId,
              projectId: input.genesisRevision.projectId,
              parentRevisionId: input.genesisRevision.parentRevisionId ?? null,
              schemaVersion: input.genesisRevision.document.schemaVersion,
              document: input.genesisRevision.document,
              contentHash: input.genesisRevision.contentHash,
              actorAccountId: input.genesisRevision.actorAccountId,
              origin: input.genesisRevision.origin,
              reason: input.genesisRevision.reason,
              createdAt: input.genesisRevision.createdAt
            });
          } catch (error) {
            const code = postgresErrorCode(error);
            if (code === "23505") {
              const raced = await queryHead(exec, input.head.captureId);
              if (raced !== undefined) return raced;
            }
            throw error;
          }

          try {
            const [created] = await exec
              .insert(captures)
              .values({
                captureId: input.head.captureId,
                projectId: input.head.projectId,
                status: input.head.status,
                sourceModality: input.head.sourceModality,
                workingVersion: input.head.workingVersion,
                schemaVersion: input.head.document.schemaVersion,
                document: input.head.document,
                contentHash: input.head.contentHash,
                genesisRevisionId: input.head.genesisRevisionId,
                authorAccountId: input.head.authorAccountId,
                updatedByAccountId: input.head.updatedByAccountId,
                createdAt: input.head.createdAt,
                updatedAt: input.head.updatedAt,
                archivedAt: input.head.archivedAt ?? null
              })
              .returning();
            if (created === undefined) {
              throw new Error("Capture document initialization returned no row.");
            }
            return headFromRow(created);
          } catch (error) {
            const code = postgresErrorCode(error);
            if (code === "23505") {
              const raced = await queryHead(exec, input.head.captureId);
              if (raced !== undefined) return raced;
            }
            throw error;
          }
        });
      } catch (error) {
        if (postgresErrorCode(error) === "23505") {
          const existing = await queryHead(db, input.head.captureId);
          if (existing !== undefined) return existing;
        }
        return mapInitializeError(error);
      }
    },
    async saveWorkingDocument(
      input: SaveWorkingCaptureDocumentInput
    ): Promise<SaveWorkingCaptureDocumentOutcome> {
      const [updated] = await db
        .update(captures)
        .set({
          workingVersion: sql`${captures.workingVersion} + 1`,
          schemaVersion: input.document.schemaVersion,
          document: input.document,
          contentHash: input.contentHash,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        })
        .where(
          and(
            eq(captures.captureId, input.captureId),
            eq(captures.projectId, input.projectId),
            eq(captures.workingVersion, input.expectedWorkingVersion),
            inArray(captures.status, ["draft", "ready"])
          )
        )
        .returning();
      if (updated !== undefined) {
        return { ok: true, head: headFromRow(updated) };
      }
      return resolveSaveConflict(db, input);
    },
    async setArchived(
      input: SetCaptureArchivedInput
    ): Promise<SetCaptureArchivedOutcome> {
      const [updated] = await db
        .update(captures)
        .set(
          input.archived
            ? {
                status: "archived",
                archivedAt: input.now,
                updatedByAccountId: input.actorAccountId,
                updatedAt: input.now
              }
            : {
                status: "draft",
                archivedAt: null,
                updatedByAccountId: input.actorAccountId,
                updatedAt: input.now
              }
        )
        .where(
          and(
            eq(captures.captureId, input.captureId),
            eq(captures.projectId, input.projectId),
            sql`${captures.status} <> 'integrated'`
          )
        )
        .returning();
      if (updated !== undefined) {
        return { ok: true, head: headFromRow(updated) };
      }

      const [row] = await db
        .select({ status: captures.status })
        .from(captures)
        .where(
          and(
            eq(captures.captureId, input.captureId),
            eq(captures.projectId, input.projectId)
          )
        )
        .limit(1);
      if (row === undefined) {
        return { ok: false, reason: "not-found" };
      }
      if (row.status === "integrated") {
        return { ok: false, reason: "capture-integrated" };
      }
      return { ok: false, reason: "not-found" };
    },
    async integrate(
      input: IntegrateCaptureDocumentInput
    ): Promise<IntegrateCaptureDocumentOutcome> {
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          return integrateInTransaction(exec, input);
        });
      } catch (error) {
        if (error instanceof DomainValidationError) {
          throw error;
        }
        const code = postgresErrorCode(error);
        if (code === "23505") {
          throw new DomainValidationError(
            "DUPLICATE_ID",
            "The capture document revision ID already exists."
          );
        }
        if (code === "23503") {
          throw new DomainValidationError(
            "UNKNOWN_REFERENCE",
            "The capture integration references a record that does not exist."
          );
        }
        throw error;
      }
    }
  });
}
