CREATE TABLE "context_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_receipts" ADD CONSTRAINT "context_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_receipts_project_id_created_at_index" ON "context_receipts" USING btree ("project_id","created_at" DESC);--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"initiator_account_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"status" text NOT NULL,
	"provider_response_id" text,
	"token_usage" jsonb,
	"terminal_diagnostic_code" text,
	"cancel_requested_at" text,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_initiator_account_id_auth_users_id_fk" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_receipt_id_context_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."context_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_project_id_created_at_index" ON "agent_runs" USING btree ("project_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "agent_runs_project_id_status_index" ON "agent_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"base_capture_id" text NOT NULL,
	"status" text NOT NULL,
	"output_schema_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"base_capture_working_version" integer NOT NULL,
	"base_capture_content_hash" text NOT NULL,
	"decision_actor_account_id" text,
	"decided_at" text,
	"applied_actor_account_id" text,
	"applied_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_receipt_id_context_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."context_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_base_capture_id_captures_capture_id_fk" FOREIGN KEY ("base_capture_id") REFERENCES "public"."captures"("capture_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_decision_actor_account_id_auth_users_id_fk" FOREIGN KEY ("decision_actor_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_applied_actor_account_id_auth_users_id_fk" FOREIGN KEY ("applied_actor_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_proposals_project_id_created_at_index" ON "agent_proposals" USING btree ("project_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "agent_proposals_run_id_index" ON "agent_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_proposals_base_capture_id_index" ON "agent_proposals" USING btree ("base_capture_id");
