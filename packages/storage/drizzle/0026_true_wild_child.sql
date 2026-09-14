ALTER TABLE "canvas_viewport_preferences" ADD COLUMN "preference_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD COLUMN "scope_views" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD COLUMN "last_scope_kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD COLUMN "last_scope_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "canvas_viewport_preferences"
SET "scope_views" = jsonb_build_object(
	'project',
	jsonb_strip_nulls(jsonb_build_object(
		'scope', jsonb_build_object('scopeKind', 'project'),
		'viewport', jsonb_build_object('x', "x", 'y', "y", 'zoom', "zoom"),
		'viewMode', 'spatial',
		'inspectorOpen', false,
		'focusToken', 'surface',
		'selectedObjectId', "selected_object_id",
		'workflowLens', 'outline',
		'updatedAt', "updated_at"
	)));--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD CONSTRAINT "canvas_viewport_preferences_scope_views_object_check" CHECK (jsonb_typeof("canvas_viewport_preferences"."scope_views") = 'object');--> statement-breakpoint
ALTER TABLE "canvas_viewport_preferences" ADD CONSTRAINT "canvas_viewport_preferences_last_scope_check" CHECK (("canvas_viewport_preferences"."last_scope_kind" = 'project' and "canvas_viewport_preferences"."last_scope_id" = '') or ("canvas_viewport_preferences"."last_scope_kind" in ('chapter', 'scene') and "canvas_viewport_preferences"."last_scope_id" <> ''));
