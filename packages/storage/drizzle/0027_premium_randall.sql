CREATE TABLE "story_work_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"initiator_account_id" text NOT NULL,
	"version" integer NOT NULL,
	"task_kind" text NOT NULL,
	"brief" text NOT NULL,
	"constraints" text NOT NULL,
	"done_when" text NOT NULL,
	"sources" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb NOT NULL,
	"active_attempt_id" text,
	"latest_attempt_id" text,
	"generated_artifact" jsonb,
	"current_artifact" jsonb,
	"results" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "story_work_assignments_version_check" CHECK ("story_work_assignments"."version" >= 1),
	CONSTRAINT "story_work_assignments_json_shape_check" CHECK (jsonb_typeof("story_work_assignments"."sources") = 'array'
        and jsonb_typeof("story_work_assignments"."destination") = 'object'
        and jsonb_typeof("story_work_assignments"."steps") = 'array'
        and jsonb_typeof("story_work_assignments"."results") = 'array'
        and ("story_work_assignments"."generated_artifact" is null or jsonb_typeof("story_work_assignments"."generated_artifact") = 'object')
        and ("story_work_assignments"."current_artifact" is null or jsonb_typeof("story_work_assignments"."current_artifact") = 'object')),
	CONSTRAINT "story_work_assignments_active_attempt_check" CHECK (("story_work_assignments"."status" = 'running') = ("story_work_assignments"."active_attempt_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "story_work_attempts" (
	"run_id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"project_id" text NOT NULL,
	"initiator_account_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"source_mode" text NOT NULL,
	"instruction" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"prior_artifact" jsonb,
	"result_artifact" jsonb,
	"created_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "story_work_attempts_version_check" CHECK ("story_work_attempts"."version" >= 1),
	CONSTRAINT "story_work_attempts_kind_check" CHECK ("story_work_attempts"."kind" in ('initial', 'revision')),
	CONSTRAINT "story_work_attempts_source_mode_check" CHECK ("story_work_attempts"."source_mode" in ('submitted-snapshot', 'latest-authorized')
        and (("story_work_attempts"."kind" = 'initial' and "story_work_attempts"."source_mode" = 'submitted-snapshot')
          or ("story_work_attempts"."kind" = 'revision' and "story_work_attempts"."source_mode" = 'latest-authorized'))),
	CONSTRAINT "story_work_attempts_artifact_shape_check" CHECK (("story_work_attempts"."prior_artifact" is null or jsonb_typeof("story_work_attempts"."prior_artifact") = 'object')
        and ("story_work_attempts"."result_artifact" is null or jsonb_typeof("story_work_attempts"."result_artifact") = 'object')
        and (("story_work_attempts"."completed_at" is null) = ("story_work_attempts"."result_artifact" is null)))
);
--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_initiator_account_id_auth_users_id_fk" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_active_attempt_id_agent_runs_id_fk" FOREIGN KEY ("active_attempt_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_latest_attempt_id_agent_runs_id_fk" FOREIGN KEY ("latest_attempt_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_attempts" ADD CONSTRAINT "story_work_attempts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_attempts" ADD CONSTRAINT "story_work_attempts_assignment_id_story_work_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."story_work_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_attempts" ADD CONSTRAINT "story_work_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_attempts" ADD CONSTRAINT "story_work_attempts_initiator_account_id_auth_users_id_fk" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_work_assignments_idempotency_unique" ON "story_work_assignments" USING btree ("initiator_account_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "story_work_assignments_project_account_updated_index" ON "story_work_assignments" USING btree ("project_id","initiator_account_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "story_work_assignments_project_account_status_index" ON "story_work_assignments" USING btree ("project_id","initiator_account_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "story_work_attempts_assignment_created_index" ON "story_work_attempts" USING btree ("project_id","initiator_account_id","assignment_id","created_at","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_work_attempts_idempotency_unique" ON "story_work_attempts" USING btree ("initiator_account_id","project_id","assignment_id","idempotency_key");