CREATE TABLE "story_knowledge_links" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "story_knowledge_links_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "backdrop" jsonb;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "music" jsonb;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "image_refs" jsonb;--> statement-breakpoint
ALTER TABLE "story_knowledge" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "story_knowledge" ADD COLUMN "aliases" jsonb;--> statement-breakpoint
ALTER TABLE "story_knowledge_links" ADD CONSTRAINT "story_knowledge_links_from_id_story_knowledge_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."story_knowledge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_knowledge_links" ADD CONSTRAINT "story_knowledge_links_to_id_story_knowledge_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."story_knowledge"("id") ON DELETE cascade ON UPDATE no action;