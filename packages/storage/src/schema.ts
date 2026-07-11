import { relations } from "drizzle-orm";
import {
  integer,
  pgTable,
  primaryKey,
  text
} from "drizzle-orm/pg-core";

/**
 * Relational form of the ADR 0003 multi-book model. Strict hierarchy edges use foreign keys;
 * scene-reference collections carry an explicit `position` for order. The circular scene <-> story
 * knowledge relationship (a scene's POV references story knowledge, which links back to scenes) is
 * intentionally not a database foreign key — the domain's whole-project validation enforces it.
 */

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull()
});

export const books = pgTable("books", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull()
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
  povStoryKnowledgeId: text("pov_story_knowledge_id")
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
  authority: text("authority").notNull()
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
  projects,
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
