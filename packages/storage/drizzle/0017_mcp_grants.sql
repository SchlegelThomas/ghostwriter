CREATE TABLE "mcp_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capture_ids" jsonb NOT NULL,
	"tools" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_account_id_auth_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_grants_token_hash_unique" ON "mcp_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_grants_project_id_created_at_index" ON "mcp_grants" USING btree ("project_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "mcp_grants_account_id_index" ON "mcp_grants" USING btree ("account_id");
