import {
  accountId,
  createSceneDocumentHead,
  createSceneEditingLease,
  createSceneRevision,
  createSceneVariant,
  DomainValidationError,
  projectId,
  revisionId,
  sceneContentHash,
  sceneId,
  sceneLeaseHolderId,
  sceneVariantId,
  type AcquireSceneLeaseInput,
  type AcquireSceneLeaseOutcome,
  type CreateNamedSceneVariantInput,
  type CreateNamedSceneVariantOutcome,
  type CreateSceneCheckpointInput,
  type CreateSceneCheckpointOutcome,
  type InitializeSceneDocumentInput,
  type ReleaseSceneLeaseInput,
  type RevisionId,
  type RestoreSceneRevisionInput,
  type RestoreSceneRevisionOutcome,
  type SaveWorkingSceneDocumentInput,
  type SaveWorkingSceneDocumentOutcome,
  type SceneConditionalMutationConflictReason,
  type SceneDocumentHead,
  type SceneDocumentRepository,
  type SceneEditingLease,
  type SceneId,
  type SceneRevision,
  type SceneRevisionMetadata,
  type SceneRevisionOrigin,
  type SceneRevisionReason,
  type SceneVariant,
  type SceneVariantId
} from "@ghostwriter/core";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  sceneDocuments,
  sceneEditingLeases,
  sceneRevisions,
  sceneVariants,
  scenes
} from "./schema.js";

function assertGenesis(input: InitializeSceneDocumentInput): void {
  const { head, genesisRevision } = input;
  if (
    genesisRevision.reason !== "genesis" ||
    genesisRevision.parentRevisionId !== undefined ||
    head.checkpointRevisionId !== genesisRevision.id ||
    head.sceneId !== genesisRevision.sceneId ||
    head.projectId !== genesisRevision.projectId ||
    head.contentHash !== genesisRevision.contentHash
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A scene document must initialize from its matching genesis revision."
    );
  }
}

function headFromRow(
  row: typeof sceneDocuments.$inferSelect
): SceneDocumentHead {
  const document = row.document as SceneDocumentHead["document"];
  if (document.schemaVersion !== row.schemaVersion) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Stored scene document schema versions do not match."
    );
  }
  return createSceneDocumentHead({
    sceneId: sceneId(row.sceneId),
    projectId: projectId(row.projectId),
    workingVersion: row.workingVersion,
    document,
    contentHash: sceneContentHash(row.contentHash),
    checkpointRevisionId: revisionId(row.checkpointRevisionId),
    updatedByAccountId: accountId(row.updatedByAccountId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function revisionFromRow(
  row: typeof sceneRevisions.$inferSelect
): SceneRevision {
  const document = row.document as SceneRevision["document"];
  if (document.schemaVersion !== row.schemaVersion) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Stored scene revision schema versions do not match."
    );
  }
  return createSceneRevision({
    id: revisionId(row.id),
    sceneId: sceneId(row.sceneId),
    projectId: projectId(row.projectId),
    ...(row.parentRevisionId === null
      ? {}
      : { parentRevisionId: revisionId(row.parentRevisionId) }),
    document,
    contentHash: sceneContentHash(row.contentHash),
    actorAccountId: accountId(row.actorAccountId),
    origin: row.origin as SceneRevisionOrigin,
    reason: row.reason as SceneRevisionReason,
    createdAt: row.createdAt
  });
}

type RevisionMetadataRow = Readonly<{
  id: string;
  sceneId: string;
  projectId: string;
  parentRevisionId: string | null;
  schemaVersion: number;
  contentHash: string;
  actorAccountId: string;
  origin: string;
  reason: string;
  createdAt: string;
}>;

function revisionMetadataFromRow(
  row: RevisionMetadataRow
): SceneRevisionMetadata {
  return Object.freeze({
    id: revisionId(row.id),
    sceneId: sceneId(row.sceneId),
    projectId: projectId(row.projectId),
    ...(row.parentRevisionId === null
      ? {}
      : { parentRevisionId: revisionId(row.parentRevisionId) }),
    schemaVersion: row.schemaVersion,
    contentHash: sceneContentHash(row.contentHash),
    actorAccountId: accountId(row.actorAccountId),
    origin: row.origin as SceneRevisionOrigin,
    reason: row.reason as SceneRevisionReason,
    createdAt: row.createdAt
  });
}

function variantFromRow(
  row: typeof sceneVariants.$inferSelect
): SceneVariant {
  return createSceneVariant({
    id: sceneVariantId(row.id),
    sceneId: sceneId(row.sceneId),
    projectId: projectId(row.projectId),
    revisionId: revisionId(row.revisionId),
    creatorAccountId: accountId(row.creatorAccountId),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function leaseFromRow(
  row: typeof sceneEditingLeases.$inferSelect
): SceneEditingLease {
  return createSceneEditingLease({
    sceneId: sceneId(row.sceneId),
    projectId: projectId(row.projectId),
    holderId: sceneLeaseHolderId(row.holderSessionId),
    acquiredAt: row.acquiredAt,
    renewedAt: row.renewedAt,
    expiresAt: row.expiresAt
  });
}

async function queryHeads(
  db: RepositoryDatabase,
  ids: readonly SceneId[]
): Promise<ReadonlyMap<SceneId, SceneDocumentHead>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select()
    .from(sceneDocuments)
    .where(inArray(sceneDocuments.sceneId, [...ids]));

  const heads = new Map<SceneId, SceneDocumentHead>();
  for (const row of rows) {
    const head = headFromRow(row);
    heads.set(head.sceneId, head);
  }
  return heads;
}

async function queryHead(
  db: RepositoryDatabase,
  id: SceneId
): Promise<SceneDocumentHead | undefined> {
  const [row] = await db
    .select()
    .from(sceneDocuments)
    .where(eq(sceneDocuments.sceneId, id))
    .limit(1);
  return row === undefined ? undefined : headFromRow(row);
}

async function queryRevision(
  db: RepositoryDatabase,
  id: RevisionId
): Promise<SceneRevision | undefined> {
  const [row] = await db
    .select()
    .from(sceneRevisions)
    .where(eq(sceneRevisions.id, id))
    .limit(1);
  return row === undefined ? undefined : revisionFromRow(row);
}

async function queryVariant(
  db: RepositoryDatabase,
  id: SceneVariantId
): Promise<SceneVariant | undefined> {
  const [row] = await db
    .select()
    .from(sceneVariants)
    .where(eq(sceneVariants.id, id))
    .limit(1);
  return row === undefined ? undefined : variantFromRow(row);
}

async function queryRevisionMetadata(
  db: RepositoryDatabase,
  id: SceneId
): Promise<readonly SceneRevisionMetadata[]> {
  const rows = await db
    .select({
      id: sceneRevisions.id,
      sceneId: sceneRevisions.sceneId,
      projectId: sceneRevisions.projectId,
      parentRevisionId: sceneRevisions.parentRevisionId,
      schemaVersion: sceneRevisions.schemaVersion,
      contentHash: sceneRevisions.contentHash,
      actorAccountId: sceneRevisions.actorAccountId,
      origin: sceneRevisions.origin,
      reason: sceneRevisions.reason,
      createdAt: sceneRevisions.createdAt
    })
    .from(sceneRevisions)
    .where(eq(sceneRevisions.sceneId, id))
    .orderBy(desc(sceneRevisions.createdAt), desc(sceneRevisions.id));
  return rows.map(revisionMetadataFromRow);
}

async function queryVariants(
  db: RepositoryDatabase,
  id: SceneId
): Promise<readonly SceneVariant[]> {
  const rows = await db
    .select()
    .from(sceneVariants)
    .where(eq(sceneVariants.sceneId, id))
    .orderBy(desc(sceneVariants.createdAt), desc(sceneVariants.id));
  return rows.map(variantFromRow);
}

async function queryLease(
  db: RepositoryDatabase,
  id: SceneId
): Promise<SceneEditingLease | undefined> {
  const [row] = await db
    .select()
    .from(sceneEditingLeases)
    .where(eq(sceneEditingLeases.sceneId, id))
    .limit(1);
  return row === undefined ? undefined : leaseFromRow(row);
}

type ConditionalSceneMutationInput =
  | CreateSceneCheckpointInput
  | CreateNamedSceneVariantInput
  | RestoreSceneRevisionInput;

type ConditionalMutationContext =
  | Readonly<{ ok: true; head: SceneDocumentHead }>
  | Readonly<{
      ok: false;
      reason: SceneConditionalMutationConflictReason;
    }>;

async function lockConditionalMutation(
  db: RepositoryDatabase,
  input: ConditionalSceneMutationInput
): Promise<ConditionalMutationContext> {
  await db.execute(
    sql`select ${sceneDocuments.sceneId} from ${sceneDocuments} where ${sceneDocuments.sceneId} = ${input.sceneId} for update`
  );
  const head = await queryHead(db, input.sceneId);
  if (
    head === undefined ||
    head.projectId !== input.projectId ||
    head.workingVersion !== input.expectedWorkingVersion
  ) {
    return { ok: false, reason: "working-version-conflict" };
  }

  const lease = await queryLease(db, input.sceneId);
  if (
    lease === undefined ||
    lease.projectId !== input.projectId ||
    lease.holderId !== input.holderId
  ) {
    return { ok: false, reason: "lease-conflict" };
  }
  if (lease.expiresAt <= input.now) {
    return { ok: false, reason: "lease-expired" };
  }
  return { ok: true, head };
}

async function insertRevision(
  db: RepositoryDatabase,
  revision: SceneRevision
): Promise<SceneRevision> {
  const [created] = await db
    .insert(sceneRevisions)
    .values({
      id: revision.id,
      sceneId: revision.sceneId,
      projectId: revision.projectId,
      parentRevisionId: revision.parentRevisionId ?? null,
      schemaVersion: revision.document.schemaVersion,
      document: revision.document,
      contentHash: revision.contentHash,
      actorAccountId: revision.actorAccountId,
      origin: revision.origin,
      reason: revision.reason,
      createdAt: revision.createdAt
    })
    .returning();
  if (created === undefined) {
    throw new Error("Scene revision insert returned no row.");
  }
  return revisionFromRow(created);
}

async function checkpointCurrentHead(
  db: RepositoryDatabase,
  input: ConditionalSceneMutationInput,
  current: SceneDocumentHead,
  newRevisionId: RevisionId
): Promise<
  Readonly<{
    head: SceneDocumentHead;
    revision: SceneRevision;
    created: boolean;
  }>
> {
  const checkpoint = await queryRevision(db, current.checkpointRevisionId);
  if (
    checkpoint === undefined ||
    checkpoint.sceneId !== current.sceneId ||
    checkpoint.projectId !== current.projectId
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "The scene checkpoint head does not exist."
    );
  }
  if (checkpoint.contentHash === current.contentHash) {
    return { head: current, revision: checkpoint, created: false };
  }

  const revision = await insertRevision(
    db,
    createSceneRevision({
      id: newRevisionId,
      sceneId: current.sceneId,
      projectId: current.projectId,
      parentRevisionId: current.checkpointRevisionId,
      document: current.document,
      contentHash: current.contentHash,
      actorAccountId: input.actorAccountId,
      origin: "human",
      reason: "checkpoint",
      createdAt: input.now
    })
  );
  const [updated] = await db
    .update(sceneDocuments)
    .set({
      workingVersion: current.workingVersion + 1,
      checkpointRevisionId: revision.id,
      updatedByAccountId: input.actorAccountId,
      updatedAt: input.now
    })
    .where(
      and(
        eq(sceneDocuments.sceneId, input.sceneId),
        eq(sceneDocuments.projectId, input.projectId),
        eq(sceneDocuments.workingVersion, current.workingVersion)
      )
    )
    .returning();
  if (updated === undefined) {
    throw new Error("Locked scene checkpoint update returned no row.");
  }
  return {
    head: headFromRow(updated),
    revision,
    created: true
  };
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
      "The scene document references a record that does not exist."
    );
  }
  if (code === "23505") {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "The scene document revision ID already exists."
    );
  }
  throw error;
}

export function createPostgresSceneDocumentRepository(
  db: RepositoryDatabase
): SceneDocumentRepository {
  return Object.freeze({
    getHead(id: SceneId): Promise<SceneDocumentHead | undefined> {
      return queryHead(db, id);
    },
    getHeads(
      ids: readonly SceneId[]
    ): Promise<ReadonlyMap<SceneId, SceneDocumentHead>> {
      return queryHeads(db, ids);
    },
    getRevision(id: RevisionId): Promise<SceneRevision | undefined> {
      return queryRevision(db, id);
    },
    getVariant(id: SceneVariantId): Promise<SceneVariant | undefined> {
      return queryVariant(db, id);
    },
    listRevisions(id: SceneId): Promise<readonly SceneRevisionMetadata[]> {
      return queryRevisionMetadata(db, id);
    },
    listVariants(id: SceneId): Promise<readonly SceneVariant[]> {
      return queryVariants(db, id);
    },
    getLease(id: SceneId): Promise<SceneEditingLease | undefined> {
      return queryLease(db, id);
    },
    async initialize(
      input: InitializeSceneDocumentInput
    ): Promise<SceneDocumentHead> {
      assertGenesis(input);
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          const existing = await queryHead(exec, input.head.sceneId);
          if (existing !== undefined) return existing;

          const [scene] = await exec
            .select({ id: scenes.id })
            .from(scenes)
            .where(
              and(
                eq(scenes.id, input.head.sceneId),
                eq(scenes.projectId, input.head.projectId)
              )
            )
            .limit(1);
          if (scene === undefined) {
            throw new DomainValidationError(
              "UNKNOWN_REFERENCE",
              "The scene document cannot initialize an unknown scene."
            );
          }

          await exec.execute(
            sql`select ${scenes.id} from ${scenes} where ${scenes.id} = ${input.head.sceneId} for update`
          );
          const initializedByAnotherRequest = await queryHead(
            exec,
            input.head.sceneId
          );
          if (initializedByAnotherRequest !== undefined) {
            return initializedByAnotherRequest;
          }

          await exec.insert(sceneRevisions).values({
            id: input.genesisRevision.id,
            sceneId: input.genesisRevision.sceneId,
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
          const [created] = await exec
            .insert(sceneDocuments)
            .values({
              sceneId: input.head.sceneId,
              projectId: input.head.projectId,
              workingVersion: input.head.workingVersion,
              schemaVersion: input.head.document.schemaVersion,
              document: input.head.document,
              contentHash: input.head.contentHash,
              checkpointRevisionId: input.head.checkpointRevisionId,
              updatedByAccountId: input.head.updatedByAccountId,
              createdAt: input.head.createdAt,
              updatedAt: input.head.updatedAt
            })
            .returning();
          if (created === undefined) {
            throw new Error("Scene document initialization returned no row.");
          }
          return headFromRow(created);
        });
      } catch (error) {
        return mapInitializeError(error);
      }
    },
    async acquireOrRenewLease(
      input: AcquireSceneLeaseInput
    ): Promise<AcquireSceneLeaseOutcome> {
      const [row] = await db
        .insert(sceneEditingLeases)
        .values({
          sceneId: input.sceneId,
          projectId: input.projectId,
          holderSessionId: input.holderId,
          acquiredAt: input.now,
          renewedAt: input.now,
          expiresAt: input.expiresAt
        })
        .onConflictDoUpdate({
          target: sceneEditingLeases.sceneId,
          set: {
            projectId: input.projectId,
            holderSessionId: input.holderId,
            acquiredAt: sql`case when ${sceneEditingLeases.holderSessionId} = ${input.holderId} and ${sceneEditingLeases.expiresAt} > ${input.now} then ${sceneEditingLeases.acquiredAt} else ${input.now} end`,
            renewedAt: input.now,
            expiresAt: input.expiresAt
          },
          setWhere: and(
            eq(sceneEditingLeases.projectId, input.projectId),
            or(
              eq(sceneEditingLeases.holderSessionId, input.holderId),
              lte(sceneEditingLeases.expiresAt, input.now)
            )
          )
        })
        .returning();
      return row === undefined
        ? { ok: false, reason: "lease-conflict" }
        : { ok: true, lease: leaseFromRow(row) };
    },
    async releaseLease(input: ReleaseSceneLeaseInput): Promise<boolean> {
      const [released] = await db
        .delete(sceneEditingLeases)
        .where(
          and(
            eq(sceneEditingLeases.sceneId, input.sceneId),
            eq(sceneEditingLeases.projectId, input.projectId),
            eq(sceneEditingLeases.holderSessionId, input.holderId)
          )
        )
        .returning({ sceneId: sceneEditingLeases.sceneId });
      return released !== undefined;
    },
    async saveWorkingDocument(
      input: SaveWorkingSceneDocumentInput
    ): Promise<SaveWorkingSceneDocumentOutcome> {
      const [updated] = await db
        .update(sceneDocuments)
        .set({
          workingVersion: sql`${sceneDocuments.workingVersion} + 1`,
          schemaVersion: input.document.schemaVersion,
          document: input.document,
          contentHash: input.contentHash,
          updatedByAccountId: input.actorAccountId,
          updatedAt: input.now
        })
        .where(
          and(
            eq(sceneDocuments.sceneId, input.sceneId),
            eq(sceneDocuments.projectId, input.projectId),
            eq(
              sceneDocuments.workingVersion,
              input.expectedWorkingVersion
            ),
            sql`exists (
              select 1
              from ${sceneEditingLeases}
              where ${sceneEditingLeases.sceneId} = ${sceneDocuments.sceneId}
                and ${sceneEditingLeases.projectId} = ${input.projectId}
                and ${sceneEditingLeases.holderSessionId} = ${input.holderId}
                and ${sceneEditingLeases.expiresAt} > ${input.now}
            )`
          )
        )
        .returning();
      if (updated !== undefined) {
        return { ok: true, head: headFromRow(updated) };
      }

      const current = await queryHead(db, input.sceneId);
      if (
        current === undefined ||
        current.projectId !== input.projectId ||
        current.workingVersion !== input.expectedWorkingVersion
      ) {
        return { ok: false, reason: "working-version-conflict" };
      }
      const lease = await queryLease(db, input.sceneId);
      if (
        lease === undefined ||
        lease.projectId !== input.projectId ||
        lease.holderId !== input.holderId
      ) {
        return { ok: false, reason: "lease-conflict" };
      }
      if (lease.expiresAt <= input.now) {
        return { ok: false, reason: "lease-expired" };
      }
      return { ok: false, reason: "lease-conflict" };
    },
    createManualCheckpoint(
      input: CreateSceneCheckpointInput
    ): Promise<CreateSceneCheckpointOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const context = await lockConditionalMutation(exec, input);
        if (!context.ok) return context;
        const checkpoint = await checkpointCurrentHead(
          exec,
          input,
          context.head,
          input.revisionId
        );
        return { ok: true, ...checkpoint };
      });
    },
    createNamedVariant(
      input: CreateNamedSceneVariantInput
    ): Promise<CreateNamedSceneVariantOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const context = await lockConditionalMutation(exec, input);
        if (!context.ok) return context;

        const [duplicate] = await exec
          .select({ id: sceneVariants.id })
          .from(sceneVariants)
          .where(
            and(
              eq(sceneVariants.sceneId, input.sceneId),
              eq(sceneVariants.name, input.name)
            )
          )
          .limit(1);
        if (duplicate !== undefined) {
          return { ok: false, reason: "variant-name-conflict" };
        }

        const checkpoint = await checkpointCurrentHead(
          exec,
          input,
          context.head,
          input.checkpointRevisionId
        );
        const [created] = await exec
          .insert(sceneVariants)
          .values({
            id: input.variantId,
            projectId: input.projectId,
            sceneId: input.sceneId,
            revisionId: checkpoint.revision.id,
            creatorAccountId: input.actorAccountId,
            name: input.name,
            createdAt: input.now,
            updatedAt: input.now
          })
          .returning();
        if (created === undefined) {
          throw new Error("Scene variant insert returned no row.");
        }
        return {
          ok: true,
          head: checkpoint.head,
          revision: checkpoint.revision,
          variant: variantFromRow(created),
          checkpointCreated: checkpoint.created
        };
      });
    },
    restoreRevision(
      input: RestoreSceneRevisionInput
    ): Promise<RestoreSceneRevisionOutcome> {
      return db.transaction(async (transaction) => {
        const exec = transaction as unknown as RepositoryDatabase;
        const context = await lockConditionalMutation(exec, input);
        if (!context.ok) return context;
        const source = await queryRevision(exec, input.sourceRevisionId);
        if (
          source === undefined ||
          source.sceneId !== input.sceneId ||
          source.projectId !== input.projectId
        ) {
          return { ok: false, reason: "revision-not-found" };
        }

        const revision = await insertRevision(
          exec,
          createSceneRevision({
            id: input.restoredRevisionId,
            sceneId: input.sceneId,
            projectId: input.projectId,
            parentRevisionId: context.head.checkpointRevisionId,
            document: source.document,
            contentHash: source.contentHash,
            actorAccountId: input.actorAccountId,
            origin: "human",
            reason: "restore",
            createdAt: input.now
          })
        );
        const [updated] = await exec
          .update(sceneDocuments)
          .set({
            workingVersion: context.head.workingVersion + 1,
            schemaVersion: source.document.schemaVersion,
            document: source.document,
            contentHash: source.contentHash,
            checkpointRevisionId: revision.id,
            updatedByAccountId: input.actorAccountId,
            updatedAt: input.now
          })
          .where(
            and(
              eq(sceneDocuments.sceneId, input.sceneId),
              eq(sceneDocuments.projectId, input.projectId),
              eq(
                sceneDocuments.workingVersion,
                context.head.workingVersion
              )
            )
          )
          .returning();
        if (updated === undefined) {
          throw new Error("Locked scene restore update returned no row.");
        }
        return {
          ok: true,
          head: headFromRow(updated),
          revision
        };
      });
    }
  });
}
