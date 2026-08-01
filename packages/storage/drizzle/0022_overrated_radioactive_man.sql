CREATE TABLE "project_catalog_playbook_overrides" (
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"doctrine" text,
	"sections" jsonb,
	"content_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_catalog_playbook_overrides_pk" PRIMARY KEY("project_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "project_catalog_playbook_overrides" ADD CONSTRAINT "project_catalog_playbook_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;