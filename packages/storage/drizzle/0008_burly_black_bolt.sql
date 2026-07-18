CREATE TABLE "canvas_scope_placements" (
	"project_id" text NOT NULL,
	"object_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision,
	"height" double precision,
	CONSTRAINT "canvas_scope_placements_pk" PRIMARY KEY("project_id","object_id","scope_kind","scope_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_scope_placements" ADD CONSTRAINT "canvas_scope_placements_project_id_canvas_boards_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."canvas_boards"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_scope_placements" ADD CONSTRAINT "canvas_scope_placements_object_id_canvas_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."canvas_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_scope_placements_project_id_index" ON "canvas_scope_placements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "canvas_scope_placements_object_id_index" ON "canvas_scope_placements" USING btree ("object_id");