CREATE TABLE "capture_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
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
CREATE TABLE "captures" (
	"capture_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"source_modality" text NOT NULL,
	"working_version" integer DEFAULT 1 NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"genesis_revision_id" text NOT NULL,
	"author_account_id" text NOT NULL,
	"updated_by_account_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "capture_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "capture_revisions_parent_revision_id_capture_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."capture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "capture_revisions_actor_account_id_auth_users_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_genesis_revision_id_capture_revisions_id_fk" FOREIGN KEY ("genesis_revision_id") REFERENCES "public"."capture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_author_account_id_auth_users_id_fk" FOREIGN KEY ("author_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_updated_by_account_id_auth_users_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_revisions_capture_id_index" ON "capture_revisions" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "capture_revisions_project_id_index" ON "capture_revisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "capture_revisions_capture_hash_index" ON "capture_revisions" USING btree ("capture_id","content_hash");--> statement-breakpoint
CREATE INDEX "captures_project_id_index" ON "captures" USING btree ("project_id");
