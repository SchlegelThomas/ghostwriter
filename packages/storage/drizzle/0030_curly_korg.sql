ALTER TABLE "mcp_grants" ALTER COLUMN "capture_ids" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "scene_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "book_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "assignment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "coordination_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD COLUMN "allow_project_structure_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD COLUMN "origin_kind" text;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD COLUMN "origin_mcp_grant_id" text;--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD COLUMN "origin_kind" text;--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD COLUMN "origin_mcp_grant_id" text;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_origin_mcp_grant_id_mcp_grants_id_fk" FOREIGN KEY ("origin_mcp_grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD CONSTRAINT "story_work_coordinations_origin_mcp_grant_id_mcp_grants_id_fk" FOREIGN KEY ("origin_mcp_grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_work_assignments_origin_grant_project_index" ON "story_work_assignments" USING btree ("origin_mcp_grant_id","project_id");--> statement-breakpoint
CREATE INDEX "story_work_coordinations_origin_grant_project_index" ON "story_work_coordinations" USING btree ("origin_mcp_grant_id","project_id");--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_json_shape_check" CHECK (jsonb_typeof("mcp_grants"."capture_ids") = 'array'
        and jsonb_typeof("mcp_grants"."scene_ids") = 'array'
        and jsonb_typeof("mcp_grants"."book_ids") = 'array'
        and jsonb_typeof("mcp_grants"."assignment_ids") = 'array'
        and jsonb_typeof("mcp_grants"."coordination_ids") = 'array'
        and jsonb_typeof("mcp_grants"."tools") = 'array');--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_origin_pair_check" CHECK ((("story_work_assignments"."origin_kind" is null and "story_work_assignments"."origin_mcp_grant_id" is null)
        or ("story_work_assignments"."origin_kind" = 'mcp' and "story_work_assignments"."origin_mcp_grant_id" is not null)));--> statement-breakpoint
ALTER TABLE "story_work_coordinations" ADD CONSTRAINT "story_work_coordinations_origin_pair_check" CHECK ((("story_work_coordinations"."origin_kind" is null and "story_work_coordinations"."origin_mcp_grant_id" is null)
        or ("story_work_coordinations"."origin_kind" = 'mcp' and "story_work_coordinations"."origin_mcp_grant_id" is not null)));