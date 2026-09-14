CREATE TABLE "story_work_coordination_step_bindings" (
	"coordination_id" text NOT NULL,
	"step_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"resolved_dependency" jsonb,
	"bound_at" text NOT NULL,
	CONSTRAINT "story_work_coordination_step_bindings_pkey" PRIMARY KEY("coordination_id","step_id"),
	CONSTRAINT "story_work_coordination_step_bindings_dependency_shape_check" CHECK ("story_work_coordination_step_bindings"."resolved_dependency" is null
        or jsonb_typeof("story_work_coordination_step_bindings"."resolved_dependency") = 'object')
);
--> statement-breakpoint
CREATE TABLE "story_work_coordinations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"initiator_account_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"step_definitions" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "story_work_coordinations_version_check" CHECK ("story_work_coordinations"."version" >= 1),
	CONSTRAINT "story_work_coordinations_status_check" CHECK ("story_work_coordinations"."status" in ('active', 'canceled')),
	CONSTRAINT "story_work_coordinations_step_definitions_shape_check" CHECK (jsonb_typeof("story_work_coordinations"."step_definitions") = 'array')
);
--> statement-breakpoint
ALTER TABLE "story_work_coordination_step_bindings" ADD CONSTRAINT "story_work_coordination_step_bindings_coordination_id_story_work_coordinations_id_fk" FOREIGN KEY ("coordination_id") REFERENCES "public"."story_work_coordinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_coordination_step_bindings" ADD CONSTRAINT "story_work_coordination_step_bindings_assignment_id_story_work_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."story_work_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD CONSTRAINT "story_work_coordinations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD CONSTRAINT "story_work_coordinations_initiator_account_id_auth_users_id_fk" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_work_coordination_step_bindings_assignment_unique" ON "story_work_coordination_step_bindings" USING btree ("coordination_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_work_coordinations_idempotency_unique" ON "story_work_coordinations" USING btree ("initiator_account_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "story_work_coordinations_project_account_updated_index" ON "story_work_coordinations" USING btree ("project_id","initiator_account_id","updated_at","id");