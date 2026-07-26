import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

/**
 * Relational form of the ADR 0003 multi-book model. Strict hierarchy edges use foreign keys;
 * scene-reference collections carry an explicit `position` for order. The circular scene <-> story
 * knowledge relationship (a scene's POV references story knowledge, which links back to scenes) is
 * intentionally not a database foreign key — the domain's whole-project validation enforces it.
 */

export const user = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    index("auth_sessions_user_id_index").on(table.userId)
  ]
);

export const account = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_unique").on(
      table.providerId,
      table.accountId
    ),
    index("auth_accounts_user_id_index").on(table.userId)
  ]
);

export const verification = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("auth_verifications_identifier_index").on(table.identifier)]
);

export const writerProfiles = pgTable("writer_profiles", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  publishing: jsonb("publishing"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: text("archived_at")
});

export const projectMemberships = pgTable(
  "project_memberships",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.accountId] }),
    index("project_memberships_account_id_index").on(table.accountId)
  ]
);

export const books = pgTable("books", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  cover: jsonb("cover"),
  archivedAt: text("archived_at")
});

export const scenes = pgTable("scenes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  povStoryKnowledgeId: text("pov_story_knowledge_id"),
  backdrop: jsonb("backdrop"),
  music: jsonb("music"),
  imageRefs: jsonb("image_refs"),
  sketch: jsonb("sketch"),
  archivedAt: text("archived_at")
});

export const sceneRevisions = pgTable(
  "scene_revisions",
  {
    id: text("id").primaryKey(),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id").references(
      (): AnyPgColumn => sceneRevisions.id,
      { onDelete: "restrict" }
    ),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    contentHash: text("content_hash").notNull(),
    actorAccountId: text("actor_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("scene_revisions_scene_id_index").on(table.sceneId),
    index("scene_revisions_project_id_index").on(table.projectId),
    index("scene_revisions_scene_hash_index").on(
      table.sceneId,
      table.contentHash
    )
  ]
);

export const sceneVariants = pgTable(
  "scene_variants",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "restrict" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: "restrict" }),
    creatorAccountId: text("creator_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("scene_variants_scene_name_unique").on(
      table.sceneId,
      table.name
    ),
    index("scene_variants_project_id_index").on(table.projectId),
    index("scene_variants_scene_id_index").on(table.sceneId),
    index("scene_variants_revision_id_index").on(table.revisionId)
  ]
);

/**
 * Capture genesis inserts revision and head in one transaction. `capture_revisions.capture_id` and
 * `captures.genesis_revision_id` reference each other; migration 0013 enforces both with
 * DEFERRABLE INITIALLY DEFERRED constraints checked at commit.
 */
export const captureRevisions = pgTable(
  "capture_revisions",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id")
      .notNull()
      .references((): AnyPgColumn => captures.captureId, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id").references(
      (): AnyPgColumn => captureRevisions.id,
      { onDelete: "restrict" }
    ),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    contentHash: text("content_hash").notNull(),
    actorAccountId: text("actor_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("capture_revisions_capture_id_index").on(table.captureId),
    index("capture_revisions_project_id_index").on(table.projectId),
    index("capture_revisions_capture_hash_index").on(
      table.captureId,
      table.contentHash
    )
  ]
);

export const captureAttachments = pgTable(
  "capture_attachments",
  {
    attachmentId: text("attachment_id").primaryKey(),
    captureId: text("capture_id")
      .notNull()
      .references(() => captures.captureId, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    displayFilename: text("display_filename").notNull(),
    declaredContentType: text("declared_content_type").notNull(),
    readyContentType: text("ready_content_type"),
    declaredByteSize: integer("declared_byte_size").notNull(),
    actualByteSize: integer("actual_byte_size"),
    clientSha256: text("client_sha256").notNull(),
    serverSha256: text("server_sha256"),
    objectKey: text("object_key").notNull(),
    pendingExpiresAt: text("pending_expires_at"),
    refusalCode: text("refusal_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    readyAt: text("ready_at"),
    deletedAt: text("deleted_at")
  },
  (table) => [
    uniqueIndex("capture_attachments_object_key_unique").on(table.objectKey),
    index("capture_attachments_capture_id_index").on(table.captureId),
    index("capture_attachments_project_id_index").on(table.projectId),
    index("capture_attachments_state_index").on(table.state),
    index("capture_attachments_pending_expires_at_index").on(table.pendingExpiresAt)
  ]
);

export const captures = pgTable(
  "captures",
  {
    captureId: text("capture_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    sourceModality: text("source_modality").notNull(),
    workingVersion: integer("working_version").notNull().default(1),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    contentHash: text("content_hash").notNull(),
    genesisRevisionId: text("genesis_revision_id")
      .notNull()
      .references(() => captureRevisions.id, { onDelete: "restrict" }),
    authorAccountId: text("author_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedByAccountId: text("updated_by_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    integrationRevisionId: text("integration_revision_id").references(
      (): AnyPgColumn => captureRevisions.id,
      { onDelete: "restrict" }
    ),
    integratedSceneId: text("integrated_scene_id").references(() => scenes.id, {
      onDelete: "restrict"
    }),
    integratedAt: text("integrated_at"),
    integratedByAccountId: text("integrated_by_account_id").references(
      () => user.id,
      { onDelete: "restrict" }
    )
  },
  (table) => [
    index("captures_project_id_index").on(table.projectId),
    index("captures_integration_revision_id_index").on(
      table.integrationRevisionId
    ),
    index("captures_integrated_scene_id_index").on(table.integratedSceneId)
  ]
);

export const sceneDocuments = pgTable(
  "scene_documents",
  {
    sceneId: text("scene_id")
      .primaryKey()
      .references(() => scenes.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    workingVersion: integer("working_version").notNull().default(1),
    schemaVersion: integer("schema_version").notNull(),
    document: jsonb("document").notNull(),
    contentHash: text("content_hash").notNull(),
    checkpointRevisionId: text("checkpoint_revision_id")
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: "restrict" }),
    updatedByAccountId: text("updated_by_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("scene_documents_project_id_index").on(table.projectId)]
);

export const sceneEditingLeases = pgTable(
  "scene_editing_leases",
  {
    sceneId: text("scene_id")
      .primaryKey()
      .references(() => scenes.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    holderSessionId: text("holder_session_id").notNull(),
    acquiredAt: text("acquired_at").notNull(),
    renewedAt: text("renewed_at").notNull(),
    expiresAt: text("expires_at").notNull()
  },
  (table) => [
    index("scene_editing_leases_project_id_index").on(table.projectId),
    index("scene_editing_leases_expiry_index").on(table.expiresAt)
  ]
);

export const manuscriptParts = pgTable("manuscript_parts", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  summary: text("summary")
});

export const manuscriptChapters = pgTable("manuscript_chapters", {
  id: text("id").primaryKey(),
  partId: text("part_id")
    .notNull()
    .references(() => manuscriptParts.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  summary: text("summary")
});

export const manuscriptChapterScenes = pgTable(
  "manuscript_chapter_scenes",
  {
    chapterId: text("chapter_id")
      .notNull()
      .references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    position: integer("position").notNull()
  },
  (table) => [primaryKey({ columns: [table.chapterId, table.sceneId] })]
);

export const bookUnassignedScenes = pgTable(
  "book_unassigned_scenes",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    position: integer("position").notNull()
  },
  (table) => [primaryKey({ columns: [table.bookId, table.sceneId] })]
);

export const storyKnowledge = pgTable("story_knowledge", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  authority: text("authority").notNull(),
  notes: text("notes"),
  aliases: jsonb("aliases"),
  characterSheet: jsonb("character_sheet"),
  visuals: jsonb("visuals"),
  archivedAt: text("archived_at")
});

export const storyKnowledgeScenes = pgTable(
  "story_knowledge_scenes",
  {
    storyKnowledgeId: text("story_knowledge_id")
      .notNull()
      .references(() => storyKnowledge.id, { onDelete: "cascade" }),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    position: integer("position").notNull()
  },
  (table) => [primaryKey({ columns: [table.storyKnowledgeId, table.sceneId] })]
);

export const storyKnowledgeLinks = pgTable(
  "story_knowledge_links",
  {
    fromId: text("from_id")
      .notNull()
      .references(() => storyKnowledge.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => storyKnowledge.id, { onDelete: "cascade" }),
    kind: text("kind").notNull()
  },
  (table) => [primaryKey({ columns: [table.fromId, table.toId, table.kind] })]
);

export const canvasBoards = pgTable("canvas_boards", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const canvasObjects = pgTable(
  "canvas_objects",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => canvasBoards.projectId, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width").notNull(),
    height: doublePrecision("height").notNull(),
    z: doublePrecision("z").notNull(),
    parentRegionId: text("parent_region_id").references(
      (): AnyPgColumn => canvasObjects.id,
      { onDelete: "restrict" }
    ),
    authority: text("authority").notNull(),
    label: text("label").notNull(),
    noteBody: text("note_body"),
    noteColor: text("note_color"),
    imageAssetId: text("image_asset_id"),
    imageAltText: text("image_alt_text"),
    imageCaption: text("image_caption"),
    imageMimeType: text("image_mime_type"),
    sceneId: text("scene_id").references(() => scenes.id, {
      onDelete: "restrict"
    }),
    storyKnowledgeId: text("story_knowledge_id").references(
      () => storyKnowledge.id,
      { onDelete: "restrict" }
    ),
    storyOrderHint: integer("story_order_hint"),
    sourceKey: text("source_key"),
    provenance: text("provenance"),
    archivedAt: text("archived_at"),
    dismissedAt: text("dismissed_at")
  },
  (table) => [
    index("canvas_objects_project_id_index").on(table.projectId),
    index("canvas_objects_scene_id_index").on(table.sceneId),
    index("canvas_objects_story_knowledge_id_index").on(
      table.storyKnowledgeId
    ),
    index("canvas_objects_parent_region_id_index").on(table.parentRegionId),
    index("canvas_objects_project_authority_index").on(
      table.projectId,
      table.authority
    ),
    index("canvas_objects_project_archive_index").on(
      table.projectId,
      table.archivedAt
    ),
    uniqueIndex("canvas_objects_project_kind_source_unique").on(
      table.projectId,
      table.kind,
      table.sourceKey
    ),
    uniqueIndex("canvas_objects_active_scene_unique")
      .on(table.projectId, table.sceneId)
      .where(sql`${table.archivedAt} is null and ${table.sceneId} is not null`),
    uniqueIndex("canvas_objects_active_knowledge_unique")
      .on(table.projectId, table.storyKnowledgeId)
      .where(
        sql`${table.archivedAt} is null and ${table.storyKnowledgeId} is not null`
      )
  ]
);

export const canvasLinks = pgTable(
  "canvas_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => canvasBoards.projectId, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    fromObjectId: text("from_object_id")
      .notNull()
      .references(() => canvasObjects.id, { onDelete: "restrict" }),
    toObjectId: text("to_object_id")
      .notNull()
      .references(() => canvasObjects.id, { onDelete: "restrict" }),
    authority: text("authority").notNull(),
    label: text("label"),
    sourceKey: text("source_key"),
    provenance: text("provenance"),
    archivedAt: text("archived_at"),
    dismissedAt: text("dismissed_at")
  },
  (table) => [
    index("canvas_links_project_id_index").on(table.projectId),
    index("canvas_links_from_object_id_index").on(table.fromObjectId),
    index("canvas_links_to_object_id_index").on(table.toObjectId),
    index("canvas_links_project_authority_index").on(
      table.projectId,
      table.authority
    ),
    index("canvas_links_project_archive_index").on(
      table.projectId,
      table.archivedAt
    ),
    uniqueIndex("canvas_links_project_kind_source_unique").on(
      table.projectId,
      table.kind,
      table.sourceKey
    ),
    uniqueIndex("canvas_links_active_equivalent_unique")
      .on(
        table.projectId,
        table.kind,
        table.fromObjectId,
        table.toObjectId
      )
      .where(sql`${table.archivedAt} is null`)
  ]
);

export const canvasScopePlacements = pgTable(
  "canvas_scope_placements",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => canvasBoards.projectId, { onDelete: "cascade" }),
    objectId: text("object_id")
      .notNull()
      .references(() => canvasObjects.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").notNull(),
    /** Empty string means no scope id (project lens). */
    scopeId: text("scope_id").notNull().default(""),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width"),
    height: doublePrecision("height")
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.objectId, table.scopeKind, table.scopeId],
      name: "canvas_scope_placements_pk"
    }),
    index("canvas_scope_placements_project_id_index").on(table.projectId),
    index("canvas_scope_placements_object_id_index").on(table.objectId)
  ]
);

export const canvasViewportPreferences = pgTable(
  "canvas_viewport_preferences",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => canvasBoards.projectId, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    zoom: doublePrecision("zoom").notNull(),
    selectedObjectId: text("selected_object_id").references(
      () => canvasObjects.id,
      { onDelete: "set null" }
    ),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.accountId] }),
    index("canvas_viewport_preferences_account_id_index").on(table.accountId)
  ]
);

export const canvasRevisions = pgTable(
  "canvas_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => canvasBoards.projectId, { onDelete: "restrict" }),
    boardVersion: integer("board_version").notNull(),
    contentHash: text("content_hash").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    actorAccountId: text("actor_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    commandType: text("command_type"),
    parentRevisionId: text("parent_revision_id").references(
      (): AnyPgColumn => canvasRevisions.id,
      { onDelete: "restrict" }
    ),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("canvas_revisions_project_version_unique").on(
      table.projectId,
      table.boardVersion
    ),
    index("canvas_revisions_project_id_index").on(table.projectId),
    index("canvas_revisions_content_hash_index").on(table.contentHash),
    index("canvas_revisions_parent_revision_id_index").on(
      table.parentRevisionId
    )
  ]
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    version: integer("version").notNull(),
    kekVersion: text("kek_version").notNull(),
    ciphertextB64: text("ciphertext_b64").notNull(),
    ivB64: text("iv_b64").notNull(),
    authTagB64: text("auth_tag_b64").notNull(),
    maskedHint: text("masked_hint").notNull(),
    validationState: text("validation_state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    validatedAt: text("validated_at")
  },
  (table) => [index("provider_credentials_kek_version_index").on(table.kekVersion)]
);

export const aiCollaborationProfiles = pgTable("ai_collaboration_profiles", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  setupSkipped: boolean("setup_skipped").notNull(),
  posture: text("posture"),
  boundaries: text("boundaries"),
  updatedAt: text("updated_at").notNull()
});

export const projectAgentInstructions = pgTable("project_agent_instructions", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const projectPlaybooks = pgTable(
  "project_playbooks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull(),
    trigger: text("trigger").notNull(),
    allowedContextClasses: jsonb("allowed_context_classes").notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    guidance: text("guidance").notNull(),
    guidanceHash: text("guidance_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at")
  },
  (table) => [
    index("project_playbooks_project_id_index").on(table.projectId),
    index("project_playbooks_archived_at_index").on(table.archivedAt)
  ]
);

export const contextReceipts = pgTable(
  "context_receipts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("context_receipts_project_id_created_at_index").on(
      table.projectId,
      table.createdAt
    )
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    initiatorAccountId: text("initiator_account_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => contextReceipts.id, { onDelete: "restrict" }),
    workflowId: text("workflow_id").notNull(),
    workflowVersion: text("workflow_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    status: text("status").notNull(),
    providerResponseId: text("provider_response_id"),
    tokenUsage: jsonb("token_usage"),
    terminalDiagnosticCode: text("terminal_diagnostic_code"),
    cancelRequestedAt: text("cancel_requested_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("agent_runs_project_id_created_at_index").on(table.projectId, table.createdAt),
    index("agent_runs_project_id_status_index").on(table.projectId, table.status)
  ]
);

export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => contextReceipts.id, { onDelete: "restrict" }),
    baseCaptureId: text("base_capture_id")
      .notNull()
      .references(() => captures.captureId, { onDelete: "restrict" }),
    status: text("status").notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    baseCaptureWorkingVersion: integer("base_capture_working_version").notNull(),
    baseCaptureContentHash: text("base_capture_content_hash").notNull(),
    decisionActorAccountId: text("decision_actor_account_id").references(() => user.id, {
      onDelete: "restrict"
    }),
    decidedAt: text("decided_at"),
    appliedActorAccountId: text("applied_actor_account_id").references(() => user.id, {
      onDelete: "restrict"
    }),
    appliedAt: text("applied_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("agent_proposals_project_id_created_at_index").on(
      table.projectId,
      table.createdAt
    ),
    index("agent_proposals_run_id_index").on(table.runId),
    index("agent_proposals_base_capture_id_index").on(table.baseCaptureId)
  ]
);

export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    captureIds: jsonb("capture_ids").notNull(),
    tools: jsonb("tools").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revokedAt: text("revoked_at")
  },
  (table) => [
    uniqueIndex("mcp_grants_token_hash_unique").on(table.tokenHash),
    index("mcp_grants_project_id_created_at_index").on(table.projectId, table.createdAt),
    index("mcp_grants_account_id_index").on(table.accountId)
  ]
);

export const editions = pgTable("editions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  projectRevisionId: text("project_revision_id").notNull(),
  createdAt: text("created_at").notNull()
});

export const editionSceneRevisions = pgTable(
  "edition_scene_revisions",
  {
    editionId: text("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").notNull(),
    position: integer("position").notNull()
  },
  (table) => [primaryKey({ columns: [table.editionId, table.sceneId] })]
);

export const booksRelations = relations(books, ({ many }) => ({
  parts: many(manuscriptParts),
  unassignedScenes: many(bookUnassignedScenes)
}));

export const partsRelations = relations(manuscriptParts, ({ many }) => ({
  chapters: many(manuscriptChapters)
}));

export const ghostwriterSchema = {
  user,
  session,
  account,
  verification,
  writerProfiles,
  projects,
  projectMemberships,
  books,
  scenes,
  sceneRevisions,
  sceneVariants,
  captureRevisions,
  captures,
  captureAttachments,
  sceneDocuments,
  sceneEditingLeases,
  manuscriptParts,
  manuscriptChapters,
  manuscriptChapterScenes,
  bookUnassignedScenes,
  storyKnowledge,
  storyKnowledgeScenes,
  storyKnowledgeLinks,
  canvasBoards,
  canvasObjects,
  canvasLinks,
  canvasScopePlacements,
  canvasViewportPreferences,
  canvasRevisions,
  providerCredentials,
  aiCollaborationProfiles,
  projectAgentInstructions,
  projectPlaybooks,
  contextReceipts,
  agentRuns,
  agentProposals,
  mcpGrants,
  editions,
  editionSceneRevisions,
  booksRelations,
  partsRelations
};

export type GhostwriterSchema = typeof ghostwriterSchema;
