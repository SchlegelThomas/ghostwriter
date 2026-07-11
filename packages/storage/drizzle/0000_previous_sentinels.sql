CREATE TABLE "book_unassigned_scenes" (
	"book_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "book_unassigned_scenes_book_id_scene_id_pk" PRIMARY KEY("book_id","scene_id")
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_scene_revisions" (
	"edition_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "edition_scene_revisions_edition_id_scene_id_pk" PRIMARY KEY("edition_id","scene_id")
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"project_revision_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_chapter_scenes" (
	"chapter_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "manuscript_chapter_scenes_chapter_id_scene_id_pk" PRIMARY KEY("chapter_id","scene_id")
);
--> statement-breakpoint
CREATE TABLE "manuscript_chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"part_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"book_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"pov_story_knowledge_id" text
);
--> statement-breakpoint
CREATE TABLE "story_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"authority" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_knowledge_scenes" (
	"story_knowledge_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "story_knowledge_scenes_story_knowledge_id_scene_id_pk" PRIMARY KEY("story_knowledge_id","scene_id")
);
--> statement-breakpoint
ALTER TABLE "book_unassigned_scenes" ADD CONSTRAINT "book_unassigned_scenes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_unassigned_scenes" ADD CONSTRAINT "book_unassigned_scenes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_scene_revisions" ADD CONSTRAINT "edition_scene_revisions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_scene_revisions" ADD CONSTRAINT "edition_scene_revisions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapter_scenes" ADD CONSTRAINT "manuscript_chapter_scenes_chapter_id_manuscript_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapter_scenes" ADD CONSTRAINT "manuscript_chapter_scenes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD CONSTRAINT "manuscript_chapters_part_id_manuscript_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."manuscript_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_parts" ADD CONSTRAINT "manuscript_parts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_knowledge" ADD CONSTRAINT "story_knowledge_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_knowledge_scenes" ADD CONSTRAINT "story_knowledge_scenes_story_knowledge_id_story_knowledge_id_fk" FOREIGN KEY ("story_knowledge_id") REFERENCES "public"."story_knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_knowledge_scenes" ADD CONSTRAINT "story_knowledge_scenes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;