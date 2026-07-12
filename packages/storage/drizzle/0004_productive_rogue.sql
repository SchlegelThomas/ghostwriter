CREATE TABLE "scene_documents" (
	"scene_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"working_version" integer DEFAULT 1 NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"checkpoint_revision_id" text NOT NULL,
	"updated_by_account_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_editing_leases" (
	"scene_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"holder_session_id" text NOT NULL,
	"acquired_at" text NOT NULL,
	"renewed_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_revision_id" text,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"actor_account_id" text NOT NULL,
	"origin" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_documents" ADD CONSTRAINT "scene_documents_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_documents" ADD CONSTRAINT "scene_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_documents" ADD CONSTRAINT "scene_documents_checkpoint_revision_id_scene_revisions_id_fk" FOREIGN KEY ("checkpoint_revision_id") REFERENCES "public"."scene_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_documents" ADD CONSTRAINT "scene_documents_updated_by_account_id_auth_users_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_editing_leases" ADD CONSTRAINT "scene_editing_leases_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_editing_leases" ADD CONSTRAINT "scene_editing_leases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_parent_revision_id_scene_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."scene_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_actor_account_id_auth_users_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_documents_project_id_index" ON "scene_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scene_editing_leases_project_id_index" ON "scene_editing_leases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scene_editing_leases_expiry_index" ON "scene_editing_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "scene_revisions_scene_id_index" ON "scene_revisions" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "scene_revisions_project_id_index" ON "scene_revisions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_revisions_scene_hash_unique" ON "scene_revisions" USING btree ("scene_id","content_hash");