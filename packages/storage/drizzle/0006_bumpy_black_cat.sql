CREATE TABLE "canvas_boards" (
	"project_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_object_id" text NOT NULL,
	"to_object_id" text NOT NULL,
	"authority" text NOT NULL,
	"label" text,
	"source_key" text,
	"provenance" text,
	"archived_at" text,
	"dismissed_at" text
);
--> statement-breakpoint
CREATE TABLE "canvas_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"z" double precision NOT NULL,
	"parent_region_id" text,
	"authority" text NOT NULL,
	"label" text NOT NULL,
	"note_body" text,
	"note_color" text,
	"image_asset_id" text,
	"image_alt_text" text,
	"image_caption" text,
	"image_mime_type" text,
	"scene_id" text,
	"story_knowledge_id" text,
	"story_order_hint" integer,
	"source_key" text,
	"provenance" text,
	"archived_at" text,
	"dismissed_at" text
);
--> statement-breakpoint
CREATE TABLE "canvas_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"board_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_account_id" text NOT NULL,
	"reason" text NOT NULL,
	"command_type" text,
	"parent_revision_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_viewport_preferences" (
	"project_id" text NOT NULL,
	"account_id" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"zoom" double precision NOT NULL,
	"selected_object_id" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "canvas_viewport_preferences_project_id_account_id_pk" PRIMARY KEY("project_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_boards" ADD CONSTRAINT "canvas_boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_links" ADD CONSTRAINT "canvas_links_project_id_canvas_boards_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_boards"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_links" ADD CONSTRAINT "canvas_links_from_object_id_canvas_objects_id_fk" FOREIGN KEY ("from_object_id") REFERENCES "public"."canvas_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_links" ADD CONSTRAINT "canvas_links_to_object_id_canvas_objects_id_fk" FOREIGN KEY ("to_object_id") REFERENCES "public"."canvas_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_objects" ADD CONSTRAINT "canvas_objects_project_id_canvas_boards_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_boards"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_objects" ADD CONSTRAINT "canvas_objects_parent_region_id_canvas_objects_id_fk" FOREIGN KEY ("parent_region_id") REFERENCES "public"."canvas_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_objects" ADD CONSTRAINT "canvas_objects_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_objects" ADD CONSTRAINT "canvas_objects_story_knowledge_id_story_knowledge_id_fk" FOREIGN KEY ("story_knowledge_id") REFERENCES "public"."story_knowledge"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_revisions" ADD CONSTRAINT "canvas_revisions_project_id_canvas_boards_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_boards"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_revisions" ADD CONSTRAINT "canvas_revisions_actor_account_id_auth_users_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_revisions" ADD CONSTRAINT "canvas_revisions_parent_revision_id_canvas_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."canvas_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD CONSTRAINT "canvas_viewport_preferences_project_id_canvas_boards_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_boards"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD CONSTRAINT "canvas_viewport_preferences_account_id_auth_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD CONSTRAINT "canvas_viewport_preferences_selected_object_id_canvas_objects_id_fk" FOREIGN KEY ("selected_object_id") REFERENCES "public"."canvas_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_links_project_id_index" ON "canvas_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "canvas_links_from_object_id_index" ON "canvas_links" USING btree ("from_object_id");--> statement-breakpoint
CREATE INDEX "canvas_links_to_object_id_index" ON "canvas_links" USING btree ("to_object_id");--> statement-breakpoint
CREATE INDEX "canvas_links_project_authority_index" ON "canvas_links" USING btree ("project_id","authority");--> statement-breakpoint
CREATE INDEX "canvas_links_project_archive_index" ON "canvas_links" USING btree ("project_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_links_project_kind_source_unique" ON "canvas_links" USING btree ("project_id","kind","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_links_active_equivalent_unique" ON "canvas_links" USING btree ("project_id","kind","from_object_id","to_object_id") WHERE "canvas_links"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "canvas_objects_project_id_index" ON "canvas_objects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "canvas_objects_scene_id_index" ON "canvas_objects" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "canvas_objects_story_knowledge_id_index" ON "canvas_objects" USING btree ("story_knowledge_id");--> statement-breakpoint
CREATE INDEX "canvas_objects_parent_region_id_index" ON "canvas_objects" USING btree ("parent_region_id");--> statement-breakpoint
CREATE INDEX "canvas_objects_project_authority_index" ON "canvas_objects" USING btree ("project_id","authority");--> statement-breakpoint
CREATE INDEX "canvas_objects_project_archive_index" ON "canvas_objects" USING btree ("project_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_objects_project_kind_source_unique" ON "canvas_objects" USING btree ("project_id","kind","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_objects_active_scene_unique" ON "canvas_objects" USING btree ("project_id","scene_id") WHERE "canvas_objects"."archived_at" is null and "canvas_objects"."scene_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_objects_active_knowledge_unique" ON "canvas_objects" USING btree ("project_id","story_knowledge_id") WHERE "canvas_objects"."archived_at" is null and "canvas_objects"."story_knowledge_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_revisions_project_version_unique" ON "canvas_revisions" USING btree ("project_id","board_version");--> statement-breakpoint
CREATE INDEX "canvas_revisions_project_id_index" ON "canvas_revisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "canvas_revisions_content_hash_index" ON "canvas_revisions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "canvas_revisions_parent_revision_id_index" ON "canvas_revisions" USING btree ("parent_revision_id");--> statement-breakpoint
CREATE INDEX "canvas_viewport_preferences_account_id_index" ON "canvas_viewport_preferences" USING btree ("account_id");