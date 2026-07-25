CREATE TABLE "provider_credentials" (
	"account_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"version" integer NOT NULL,
	"kek_version" text NOT NULL,
	"ciphertext_b64" text NOT NULL,
	"iv_b64" text NOT NULL,
	"auth_tag_b64" text NOT NULL,
	"masked_hint" text NOT NULL,
	"validation_state" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"validated_at" text
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_account_id_auth_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credentials_kek_version_index" ON "provider_credentials" USING btree ("kek_version");--> statement-breakpoint
CREATE TABLE "ai_collaboration_profiles" (
	"account_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"setup_skipped" boolean NOT NULL,
	"posture" text,
	"boundaries" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_collaboration_profiles" ADD CONSTRAINT "ai_collaboration_profiles_account_id_auth_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "project_agent_instructions" (
	"project_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_agent_instructions" ADD CONSTRAINT "project_agent_instructions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "project_playbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"trigger" text NOT NULL,
	"allowed_context_classes" jsonb NOT NULL,
	"output_schema_id" text NOT NULL,
	"guidance" text NOT NULL,
	"guidance_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
ALTER TABLE "project_playbooks" ADD CONSTRAINT "project_playbooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_playbooks_project_id_index" ON "project_playbooks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_playbooks_archived_at_index" ON "project_playbooks" USING btree ("archived_at");
