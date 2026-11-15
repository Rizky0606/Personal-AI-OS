ALTER TABLE "memories" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "memories"."text")) STORED;--> statement-breakpoint
CREATE INDEX "memories_tsv_idx" ON "memories" USING gin ("tsv");