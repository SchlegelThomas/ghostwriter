CREATE TABLE "scene_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"creator_account_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "scene_revisions_scene_hash_unique";--> statement-breakpoint
ALTER TABLE "scene_variants" ADD CONSTRAINT "scene_variants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_variants" ADD CONSTRAINT "scene_variants_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_variants" ADD CONSTRAINT "scene_variants_revision_id_scene_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."scene_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_variants" ADD CONSTRAINT "scene_variants_creator_account_id_auth_users_id_fk" FOREIGN KEY ("creator_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scene_variants_scene_name_unique" ON "scene_variants" USING btree ("scene_id","name");--> statement-breakpoint
CREATE INDEX "scene_variants_project_id_index" ON "scene_variants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scene_variants_scene_id_index" ON "scene_variants" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "scene_variants_revision_id_index" ON "scene_variants" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "scene_revisions_scene_hash_index" ON "scene_revisions" USING btree ("scene_id","content_hash");