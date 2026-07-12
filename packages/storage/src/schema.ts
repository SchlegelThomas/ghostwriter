import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
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
  archivedAt: text("archived_at")
});

export const manuscriptParts = pgTable("manuscript_parts", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull()
});

export const manuscriptChapters = pgTable("manuscript_chapters", {
  id: text("id").primaryKey(),
  partId: text("part_id")
    .notNull()
    .references(() => manuscriptParts.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull()
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
  manuscriptParts,
  manuscriptChapters,
  manuscriptChapterScenes,
  bookUnassignedScenes,
  storyKnowledge,
  storyKnowledgeScenes,
  editions,
  editionSceneRevisions,
  booksRelations,
  partsRelations
};

export type GhostwriterSchema = typeof ghostwriterSchema;
