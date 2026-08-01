ALTER TABLE "agent_proposals" ALTER COLUMN "base_capture_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ALTER COLUMN "base_capture_working_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ALTER COLUMN "base_capture_content_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "primary_target_kind" text;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "primary_target_id" text;--> statement-breakpoint
UPDATE "agent_proposals"
SET "primary_target_kind" = 'capture',
    "primary_target_id" = "base_capture_id"
WHERE "primary_target_kind" IS NULL OR "primary_target_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ALTER COLUMN "primary_target_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_proposals" ALTER COLUMN "primary_target_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_proposals_primary_target_index" ON "agent_proposals" USING btree ("project_id","primary_target_kind","primary_target_id","status","created_at");--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_primary_target_kind_check" CHECK ("agent_proposals"."primary_target_kind" in ('capture', 'scene', 'story-knowledge', 'book', 'project'));--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_capture_binding_check" CHECK ((
        ("agent_proposals"."primary_target_kind" = 'capture'
          and "agent_proposals"."base_capture_id" is not null
          and "agent_proposals"."base_capture_working_version" is not null
          and "agent_proposals"."base_capture_content_hash" is not null
          and "agent_proposals"."primary_target_id" = "agent_proposals"."base_capture_id")
        or
        ("agent_proposals"."primary_target_kind" <> 'capture'
          and (
            ("agent_proposals"."base_capture_id" is null
              and "agent_proposals"."base_capture_working_version" is null
              and "agent_proposals"."base_capture_content_hash" is null)
            or
            ("agent_proposals"."base_capture_id" is not null
              and "agent_proposals"."base_capture_working_version" is not null
              and "agent_proposals"."base_capture_content_hash" is not null)
          ))
      ));