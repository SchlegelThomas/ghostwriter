ALTER TABLE "story_work_assignments" DROP CONSTRAINT "story_work_assignments_json_shape_check";--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD COLUMN "apply_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD COLUMN "apply_request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "story_work_assignments" ADD CONSTRAINT "story_work_assignments_json_shape_check" CHECK (jsonb_typeof("story_work_assignments"."sources") = 'array'
        and jsonb_typeof("story_work_assignments"."destination") = 'object'
        and jsonb_typeof("story_work_assignments"."steps") = 'array'
        and jsonb_typeof("story_work_assignments"."results") = 'array'
        and ("story_work_assignments"."generated_artifact" is null or jsonb_typeof("story_work_assignments"."generated_artifact") = 'object')
        and ("story_work_assignments"."current_artifact" is null or jsonb_typeof("story_work_assignments"."current_artifact") = 'object')
        and (("story_work_assignments"."apply_idempotency_key" is null) = ("story_work_assignments"."apply_request_fingerprint" is null)));