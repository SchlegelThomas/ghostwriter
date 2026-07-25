CREATE TABLE "capture_attachments" (
	"attachment_id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"project_id" text NOT NULL,
	"state" text NOT NULL,
	"display_filename" text NOT NULL,
	"declared_content_type" text NOT NULL,
	"ready_content_type" text,
	"declared_byte_size" integer NOT NULL,
	"actual_byte_size" integer,
	"client_sha256" text NOT NULL,
	"server_sha256" text,
	"object_key" text NOT NULL,
	"pending_expires_at" text,
	"refusal_code" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"ready_at" text,
	"deleted_at" text
);
--> statement-breakpoint
ALTER TABLE "capture_attachments" ADD CONSTRAINT "capture_attachments_capture_id_captures_capture_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("capture_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attachments" ADD CONSTRAINT "capture_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_attachments_object_key_unique" ON "capture_attachments" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "capture_attachments_capture_id_index" ON "capture_attachments" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "capture_attachments_project_id_index" ON "capture_attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "capture_attachments_state_index" ON "capture_attachments" USING btree ("state");--> statement-breakpoint
CREATE INDEX "capture_attachments_pending_expires_at_index" ON "capture_attachments" USING btree ("pending_expires_at");
