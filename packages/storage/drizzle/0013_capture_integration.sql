ALTER TABLE "captures" ADD COLUMN "integration_revision_id" text;--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "integrated_scene_id" text;--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "integrated_at" text;--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "integrated_by_account_id" text;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_integration_revision_id_capture_revisions_id_fk" FOREIGN KEY ("integration_revision_id") REFERENCES "public"."capture_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_integrated_scene_id_scenes_id_fk" FOREIGN KEY ("integrated_scene_id") REFERENCES "public"."scenes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_integrated_by_account_id_auth_users_id_fk" FOREIGN KEY ("integrated_by_account_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captures_integration_revision_id_index" ON "captures" USING btree ("integration_revision_id");--> statement-breakpoint
CREATE INDEX "captures_integrated_scene_id_index" ON "captures" USING btree ("integrated_scene_id");--> statement-breakpoint
ALTER TABLE "captures" DROP CONSTRAINT "captures_genesis_revision_id_capture_revisions_id_fk";--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_genesis_revision_id_capture_revisions_id_fk" FOREIGN KEY ("genesis_revision_id") REFERENCES "public"."capture_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD CONSTRAINT "capture_revisions_capture_id_captures_capture_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("capture_id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
