import {
  accountId,
  canvasContentHash,
  canvasLinkId,
  canvasObjectId,
  canvasRevisionId,
  createCanvasBoard,
  createCanvasLink,
  createCanvasObject,
  createCanvasRevision,
  createCanvasScopePlacement,
  createCanvasViewportPreference,
  projectId,
  sceneId,
  storyKnowledgeId,
  CanvasVersionConflictError,
  DomainValidationError,
  type CanvasAuthority,
  type CanvasBoard,
  type CanvasCommand,
  type CanvasLink,
  type CanvasLinkKind,
  type CanvasObject,
  type CanvasObjectKind,
  type CanvasRepository,
  type CanvasRevision,
  type CanvasRevisionMetadata,
  type CanvasRevisionReason,
  type CanvasScopeKind,
  type CanvasScopePlacement,
  type ProjectId
} from "@ghostwriter/core";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import type { RepositoryDatabase } from "./client.js";
import {
  canvasBoards,
  canvasLinks,
  canvasObjects,
  canvasRevisions,
  canvasScopePlacements,
  canvasViewportPreferences,
  projects
} from "./schema.js";

function objectFromRow(
  row: typeof canvasObjects.$inferSelect
): CanvasObject {
  const note =
    row.noteBody === null && row.noteColor === null
      ? undefined
      : {
          ...(row.noteBody === null ? {} : { body: row.noteBody }),
          ...(row.noteColor === null ? {} : { color: row.noteColor })
        };
  const image =
    row.imageAssetId === null &&
    row.imageAltText === null &&
    row.imageCaption === null &&
    row.imageMimeType === null
      ? undefined
      : {
          ...(row.imageAssetId === null ? {} : { assetId: row.imageAssetId }),
          ...(row.imageAltText === null ? {} : { altText: row.imageAltText }),
          ...(row.imageCaption === null ? {} : { caption: row.imageCaption }),
          ...(row.imageMimeType === null ? {} : { mimeType: row.imageMimeType })
        };
  return createCanvasObject({
    id: canvasObjectId(row.id),
    projectId: projectId(row.projectId),
    kind: row.kind as CanvasObjectKind,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    ...(row.parentRegionId === null
      ? {}
      : { parentRegionId: canvasObjectId(row.parentRegionId) }),
    authority: row.authority as CanvasAuthority,
    label: row.label,
    ...(note === undefined ? {} : { note }),
    ...(image === undefined ? {} : { image }),
    ...(row.sceneId === null ? {} : { sceneId: sceneId(row.sceneId) }),
    ...(row.storyKnowledgeId === null
      ? {}
      : { storyKnowledgeId: storyKnowledgeId(row.storyKnowledgeId) }),
    ...(row.storyOrderHint === null
      ? {}
      : { storyOrderHint: row.storyOrderHint }),
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    ...(row.provenance === null ? {} : { provenance: row.provenance }),
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
    ...(row.dismissedAt === null ? {} : { dismissedAt: row.dismissedAt })
  });
}

function linkFromRow(row: typeof canvasLinks.$inferSelect): CanvasLink {
  return createCanvasLink({
    id: canvasLinkId(row.id),
    projectId: projectId(row.projectId),
    kind: row.kind as CanvasLinkKind,
    fromObjectId: canvasObjectId(row.fromObjectId),
    toObjectId: canvasObjectId(row.toObjectId),
    authority: row.authority as CanvasAuthority,
    ...(row.label === null ? {} : { label: row.label }),
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    ...(row.provenance === null ? {} : { provenance: row.provenance }),
    ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
    ...(row.dismissedAt === null ? {} : { dismissedAt: row.dismissedAt })
  });
}

function placementFromRow(
  row: typeof canvasScopePlacements.$inferSelect
): CanvasScopePlacement {
  return createCanvasScopePlacement({
    objectId: canvasObjectId(row.objectId),
    scopeKind: row.scopeKind as CanvasScopeKind,
    ...(row.scopeId === "" ? {} : { scopeId: row.scopeId }),
    x: row.x,
    y: row.y,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height })
  });
}

function storedBoard(value: unknown): CanvasBoard {
  const raw = value as CanvasBoard & {
    scopePlacements?: readonly CanvasScopePlacement[];
  };
  return createCanvasBoard({
    projectId: projectId(raw.projectId),
    version: raw.version,
    objects: raw.objects.map((object) =>
      createCanvasObject({
        ...object,
        id: canvasObjectId(object.id),
        projectId: projectId(object.projectId),
        ...(object.parentRegionId === undefined
          ? {}
          : { parentRegionId: canvasObjectId(object.parentRegionId) }),
        ...(object.sceneId === undefined
          ? {}
          : { sceneId: sceneId(object.sceneId) }),
        ...(object.storyKnowledgeId === undefined
          ? {}
          : {
              storyKnowledgeId: storyKnowledgeId(object.storyKnowledgeId)
            })
      })
    ),
    links: raw.links.map((link) =>
      createCanvasLink({
        ...link,
        id: canvasLinkId(link.id),
        projectId: projectId(link.projectId),
        fromObjectId: canvasObjectId(link.fromObjectId),
        toObjectId: canvasObjectId(link.toObjectId)
      })
    ),
    scopePlacements: (raw.scopePlacements ?? []).map((placement) =>
      createCanvasScopePlacement({
        ...placement,
        objectId: canvasObjectId(placement.objectId)
      })
    ),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  });
}

function revisionFromRow(
  row: typeof canvasRevisions.$inferSelect
): CanvasRevision {
  return createCanvasRevision({
    id: canvasRevisionId(row.id),
    projectId: projectId(row.projectId),
    boardVersion: row.boardVersion,
    contentHash: canvasContentHash(row.contentHash),
    snapshot: storedBoard(row.snapshot),
    actorAccountId: accountId(row.actorAccountId),
    reason: row.reason as CanvasRevisionReason,
    ...(row.commandType === null
      ? {}
      : { commandType: row.commandType as CanvasCommand["type"] }),
    ...(row.parentRevisionId === null
      ? {}
      : { parentRevisionId: canvasRevisionId(row.parentRevisionId) }),
    createdAt: row.createdAt
  });
}

type RevisionMetadataRow = Omit<
  typeof canvasRevisions.$inferSelect,
  "snapshot"
>;

function revisionMetadataFromRow(
  row: RevisionMetadataRow
): CanvasRevisionMetadata {
  return Object.freeze({
    id: canvasRevisionId(row.id),
    projectId: projectId(row.projectId),
    boardVersion: row.boardVersion,
    contentHash: canvasContentHash(row.contentHash),
    actorAccountId: accountId(row.actorAccountId),
    reason: row.reason as CanvasRevisionReason,
    ...(row.commandType === null
      ? {}
      : { commandType: row.commandType as CanvasCommand["type"] }),
    ...(row.parentRevisionId === null
      ? {}
      : { parentRevisionId: canvasRevisionId(row.parentRevisionId) }),
    createdAt: row.createdAt
  });
}

async function queryBoard(
  db: RepositoryDatabase,
  id: ProjectId
): Promise<CanvasBoard | undefined> {
  const [boardRow] = await db
    .select()
    .from(canvasBoards)
    .where(eq(canvasBoards.projectId, id))
    .limit(1);
  if (boardRow === undefined) return undefined;
  const [objectRows, linkRows, placementRows] = await Promise.all([
    db
      .select()
      .from(canvasObjects)
      .where(eq(canvasObjects.projectId, id))
      .orderBy(asc(canvasObjects.id)),
    db
      .select()
      .from(canvasLinks)
      .where(eq(canvasLinks.projectId, id))
      .orderBy(asc(canvasLinks.id)),
    db
      .select()
      .from(canvasScopePlacements)
      .where(eq(canvasScopePlacements.projectId, id))
      .orderBy(
        asc(canvasScopePlacements.objectId),
        asc(canvasScopePlacements.scopeKind),
        asc(canvasScopePlacements.scopeId)
      )
  ]);
  return createCanvasBoard({
    projectId: projectId(boardRow.projectId),
    version: boardRow.version,
    objects: objectRows.map(objectFromRow),
    links: linkRows.map(linkFromRow),
    scopePlacements: placementRows.map(placementFromRow),
    createdAt: boardRow.createdAt,
    updatedAt: boardRow.updatedAt
  });
}

function objectRow(object: CanvasObject): typeof canvasObjects.$inferInsert {
  return {
    id: object.id,
    projectId: object.projectId,
    kind: object.kind,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    z: object.z,
    parentRegionId: null,
    authority: object.authority,
    label: object.label,
    noteBody: object.note?.body ?? null,
    noteColor: object.note?.color ?? null,
    imageAssetId: object.image?.assetId ?? null,
    imageAltText: object.image?.altText ?? null,
    imageCaption: object.image?.caption ?? null,
    imageMimeType: object.image?.mimeType ?? null,
    sceneId: object.sceneId ?? null,
    storyKnowledgeId: object.storyKnowledgeId ?? null,
    storyOrderHint: object.storyOrderHint ?? null,
    sourceKey: object.sourceKey ?? null,
    provenance: object.provenance ?? null,
    archivedAt: object.archivedAt ?? null,
    dismissedAt: object.dismissedAt ?? null
  };
}

function linkRow(link: CanvasLink): typeof canvasLinks.$inferInsert {
  return {
    id: link.id,
    projectId: link.projectId,
    kind: link.kind,
    fromObjectId: link.fromObjectId,
    toObjectId: link.toObjectId,
    authority: link.authority,
    label: link.label ?? null,
    sourceKey: link.sourceKey ?? null,
    provenance: link.provenance ?? null,
    archivedAt: link.archivedAt ?? null,
    dismissedAt: link.dismissedAt ?? null
  };
}

function placementRow(
  projectIdValue: ProjectId,
  placement: CanvasScopePlacement
): typeof canvasScopePlacements.$inferInsert {
  return {
    projectId: projectIdValue,
    objectId: placement.objectId,
    scopeKind: placement.scopeKind,
    scopeId: placement.scopeId ?? "",
    x: placement.x,
    y: placement.y,
    width: placement.width ?? null,
    height: placement.height ?? null
  };
}

async function insertRevision(
  db: RepositoryDatabase,
  revision: CanvasRevision
): Promise<void> {
  await db.insert(canvasRevisions).values({
    id: revision.id,
    projectId: revision.projectId,
    boardVersion: revision.boardVersion,
    contentHash: revision.contentHash,
    snapshot: revision.snapshot,
    actorAccountId: revision.actorAccountId,
    reason: revision.reason,
    commandType: revision.commandType ?? null,
    parentRevisionId: revision.parentRevisionId ?? null,
    createdAt: revision.createdAt
  });
}

function assertMutation(input: {
  board: CanvasBoard;
  revision: CanvasRevision;
}): void {
  if (
    input.revision.projectId !== input.board.projectId ||
    input.revision.boardVersion !== input.board.version ||
    JSON.stringify(input.revision.snapshot) !== JSON.stringify(input.board)
  ) {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "Canvas mutation revision does not match its board."
    );
  }
}

async function upsertObjects(
  db: RepositoryDatabase,
  board: CanvasBoard
): Promise<void> {
  if (board.objects.length === 0) return;
  await db
    .insert(canvasObjects)
    .values(board.objects.map(objectRow))
    .onConflictDoUpdate({
      target: canvasObjects.id,
      set: {
        projectId: sql`excluded.project_id`,
        kind: sql`excluded.kind`,
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        z: sql`excluded.z`,
        parentRegionId: null,
        authority: sql`excluded.authority`,
        label: sql`excluded.label`,
        noteBody: sql`excluded.note_body`,
        noteColor: sql`excluded.note_color`,
        imageAssetId: sql`excluded.image_asset_id`,
        imageAltText: sql`excluded.image_alt_text`,
        imageCaption: sql`excluded.image_caption`,
        imageMimeType: sql`excluded.image_mime_type`,
        sceneId: sql`excluded.scene_id`,
        storyKnowledgeId: sql`excluded.story_knowledge_id`,
        storyOrderHint: sql`excluded.story_order_hint`,
        sourceKey: sql`excluded.source_key`,
        provenance: sql`excluded.provenance`,
        archivedAt: sql`excluded.archived_at`,
        dismissedAt: sql`excluded.dismissed_at`
      }
    });
}

async function upsertLinks(
  db: RepositoryDatabase,
  board: CanvasBoard
): Promise<void> {
  if (board.links.length === 0) return;
  await db
    .insert(canvasLinks)
    .values(board.links.map(linkRow))
    .onConflictDoUpdate({
      target: canvasLinks.id,
      set: {
        projectId: sql`excluded.project_id`,
        kind: sql`excluded.kind`,
        fromObjectId: sql`excluded.from_object_id`,
        toObjectId: sql`excluded.to_object_id`,
        authority: sql`excluded.authority`,
        label: sql`excluded.label`,
        sourceKey: sql`excluded.source_key`,
        provenance: sql`excluded.provenance`,
        archivedAt: sql`excluded.archived_at`,
        dismissedAt: sql`excluded.dismissed_at`
      }
    });
}

async function replaceScopePlacements(
  db: RepositoryDatabase,
  board: CanvasBoard
): Promise<void> {
  await db
    .delete(canvasScopePlacements)
    .where(eq(canvasScopePlacements.projectId, board.projectId));
  if (board.scopePlacements.length === 0) return;
  await db
    .insert(canvasScopePlacements)
    .values(
      board.scopePlacements.map((placement) =>
        placementRow(board.projectId, placement)
      )
    );
}

async function removeMissingRows(
  db: RepositoryDatabase,
  board: CanvasBoard
): Promise<void> {
  if (board.links.length === 0) {
    await db.delete(canvasLinks).where(eq(canvasLinks.projectId, board.projectId));
  } else {
    await db
      .delete(canvasLinks)
      .where(
        and(
          eq(canvasLinks.projectId, board.projectId),
          notInArray(
            canvasLinks.id,
            board.links.map((link) => link.id)
          )
        )
      );
  }
  if (board.objects.length === 0) {
    await db
      .delete(canvasObjects)
      .where(eq(canvasObjects.projectId, board.projectId));
  } else {
    await db
      .delete(canvasObjects)
      .where(
        and(
          eq(canvasObjects.projectId, board.projectId),
          notInArray(
            canvasObjects.id,
            board.objects.map((object) => object.id)
          )
        )
      );
  }
}

async function restoreRegionParents(
  db: RepositoryDatabase,
  board: CanvasBoard
): Promise<void> {
  for (const object of board.objects) {
    if (object.parentRegionId === undefined) continue;
    await db
      .update(canvasObjects)
      .set({ parentRegionId: object.parentRegionId })
      .where(
        and(
          eq(canvasObjects.projectId, board.projectId),
          eq(canvasObjects.id, object.id)
        )
      );
  }
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

function mapPersistError(error: unknown): never {
  if (
    error instanceof DomainValidationError ||
    error instanceof CanvasVersionConflictError
  ) {
    throw error;
  }
  const code = postgresErrorCode(error);
  if (code === "23505") {
    throw new DomainValidationError(
      "DUPLICATE_ID",
      "A Canvas record with this identity or reference already exists."
    );
  }
  if (code === "23503") {
    throw new DomainValidationError(
      "UNKNOWN_REFERENCE",
      "A Canvas record references a record that does not exist."
    );
  }
  throw error;
}

export function createPostgresCanvasRepository(
  db: RepositoryDatabase
): CanvasRepository {
  const repository: CanvasRepository = {
    getBoard(id): Promise<CanvasBoard | undefined> {
      return queryBoard(db, id);
    },
    async initialize(input): Promise<CanvasBoard> {
      const board = createCanvasBoard(input.board);
      const revision = createCanvasRevision(input.revision);
      assertMutation({ board, revision });
      if (board.version !== 1 || revision.reason !== "genesis") {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "A new Canvas must initialize at version one with a genesis revision."
        );
      }
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          await exec.execute(
            sql`select ${projects.id} from ${projects} where ${projects.id} = ${board.projectId} for update`
          );
          const existing = await queryBoard(exec, board.projectId);
          if (existing !== undefined) return existing;
          const [owner] = await exec
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, board.projectId))
            .limit(1);
          if (owner === undefined) {
            throw new DomainValidationError(
              "UNKNOWN_REFERENCE",
              "A Canvas cannot initialize an unknown project."
            );
          }
          await exec.insert(canvasBoards).values({
            projectId: board.projectId,
            version: board.version,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt
          });
          await insertRevision(exec, revision);
          return board;
        });
      } catch (error) {
        return mapPersistError(error);
      }
    },
    async replace(input): Promise<CanvasBoard> {
      const board = createCanvasBoard(input.mutation.board);
      const revision = createCanvasRevision(input.mutation.revision);
      assertMutation({ board, revision });
      if (board.version !== input.expectedCanvasVersion + 1) {
        throw new DomainValidationError(
          "INVALID_VERSION",
          "A Canvas replacement must increment its version exactly once."
        );
      }
      try {
        return await db.transaction(async (transaction) => {
          const exec = transaction as unknown as RepositoryDatabase;
          const [updated] = await exec
            .update(canvasBoards)
            .set({
              version: board.version,
              createdAt: board.createdAt,
              updatedAt: board.updatedAt
            })
            .where(
              and(
                eq(canvasBoards.projectId, board.projectId),
                eq(canvasBoards.version, input.expectedCanvasVersion)
              )
            )
            .returning({ projectId: canvasBoards.projectId });
          if (updated === undefined) {
            throw new CanvasVersionConflictError(
              board.projectId,
              input.expectedCanvasVersion
            );
          }

          const replacementArchiveMarker = `canvas-replace-${board.version}`;
          await exec
            .update(canvasLinks)
            .set({ archivedAt: replacementArchiveMarker })
            .where(eq(canvasLinks.projectId, board.projectId));
          await exec
            .update(canvasObjects)
            .set({
              parentRegionId: null,
              archivedAt: replacementArchiveMarker
            })
            .where(eq(canvasObjects.projectId, board.projectId));
          await upsertObjects(exec, board);
          await upsertLinks(exec, board);
          await removeMissingRows(exec, board);
          await restoreRegionParents(exec, board);
          await replaceScopePlacements(exec, board);
          await insertRevision(exec, revision);
          const persisted = await queryBoard(exec, board.projectId);
          if (persisted === undefined) {
            throw new Error("Canvas replacement returned no board.");
          }
          return persisted;
        });
      } catch (error) {
        return mapPersistError(error);
      }
    },
    async getRevision(id, revisionId) {
      const [row] = await db
        .select()
        .from(canvasRevisions)
        .where(
          and(
            eq(canvasRevisions.projectId, id),
            eq(canvasRevisions.id, revisionId)
          )
        )
        .limit(1);
      return row === undefined ? undefined : revisionFromRow(row);
    },
    async listRevisions(id): Promise<readonly CanvasRevisionMetadata[]> {
      const rows = await db
        .select({
          id: canvasRevisions.id,
          projectId: canvasRevisions.projectId,
          boardVersion: canvasRevisions.boardVersion,
          contentHash: canvasRevisions.contentHash,
          actorAccountId: canvasRevisions.actorAccountId,
          reason: canvasRevisions.reason,
          commandType: canvasRevisions.commandType,
          parentRevisionId: canvasRevisions.parentRevisionId,
          createdAt: canvasRevisions.createdAt
        })
        .from(canvasRevisions)
        .where(eq(canvasRevisions.projectId, id))
        .orderBy(
          desc(canvasRevisions.boardVersion),
          desc(canvasRevisions.createdAt)
        );
      return rows.map(revisionMetadataFromRow);
    },
    async getViewportPreference(id, idOfAccount) {
      const [row] = await db
        .select()
        .from(canvasViewportPreferences)
        .where(
          and(
            eq(canvasViewportPreferences.projectId, id),
            eq(canvasViewportPreferences.accountId, idOfAccount)
          )
        )
        .limit(1);
      return row === undefined
        ? undefined
        : createCanvasViewportPreference({
            projectId: projectId(row.projectId),
            accountId: accountId(row.accountId),
            x: row.x,
            y: row.y,
            zoom: row.zoom,
            ...(row.selectedObjectId === null
              ? {}
              : { selectedObjectId: canvasObjectId(row.selectedObjectId) }),
            updatedAt: row.updatedAt
          });
    },
    async saveViewportPreference(preference) {
      const validated = createCanvasViewportPreference(preference);
      const [row] = await db
        .insert(canvasViewportPreferences)
        .values({
          projectId: validated.projectId,
          accountId: validated.accountId,
          x: validated.x,
          y: validated.y,
          zoom: validated.zoom,
          selectedObjectId: validated.selectedObjectId ?? null,
          updatedAt: validated.updatedAt
        })
        .onConflictDoUpdate({
          target: [
            canvasViewportPreferences.projectId,
            canvasViewportPreferences.accountId
          ],
          set: {
            x: validated.x,
            y: validated.y,
            zoom: validated.zoom,
            selectedObjectId: validated.selectedObjectId ?? null,
            updatedAt: validated.updatedAt
          }
        })
        .returning();
      if (row === undefined) {
        throw new Error("Canvas viewport preference save returned no row.");
      }
      return createCanvasViewportPreference({
        projectId: projectId(row.projectId),
        accountId: accountId(row.accountId),
        x: row.x,
        y: row.y,
        zoom: row.zoom,
        ...(row.selectedObjectId === null
          ? {}
          : { selectedObjectId: canvasObjectId(row.selectedObjectId) }),
        updatedAt: row.updatedAt
      });
    }
  };
  return Object.freeze(repository);
}
